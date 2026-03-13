require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { body, validationResult } = require('express-validator');
const Database = require('better-sqlite3');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const port = 3001;

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(CLIENT_ID);

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://accounts.google.com", "https://g.notify.usercontent.com"],
            frameSrc: ["'self'", "https://accounts.google.com"],
            connectSrc: ["'self'", "https://accounts.google.com", "https://*.googleapis.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn-uicons.flaticon.com"],
            imgSrc: ["'self'", "data:", "https://tile.openstreetmap.org", "https://*.basemaps.cartocdn.com", "blob:"],
            fontSrc: ["'self'", "https://cdn-uicons.flaticon.com"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadsDir));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Demasiadas peticiones seguidas' }
});
app.use('/api/', limiter);

const db = new Database('farmio.db', { verbose: console.log });
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT,
        name TEXT,
        role TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS producers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        web TEXT,
        products TEXT,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        icon TEXT DEFAULT 'fi fi-sr-apple-whole',
        color TEXT DEFAULT '#E74C3C',
        image TEXT,
        rating_sum REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        owner_id TEXT
      );
    `);

    const columns = db.prepare("PRAGMA table_info(producers)").all();
    const colNames = columns.map(c => c.name);

    if (!colNames.includes('rating_sum')) db.prepare("ALTER TABLE producers ADD COLUMN rating_sum REAL DEFAULT 0").run();
    if (!colNames.includes('rating_count')) db.prepare("ALTER TABLE producers ADD COLUMN rating_count INTEGER DEFAULT 0").run();
    if (!colNames.includes('owner_id')) db.prepare("ALTER TABLE producers ADD COLUMN owner_id TEXT").run();
    if (!colNames.includes('image')) db.prepare("ALTER TABLE producers ADD COLUMN image TEXT").run();

    db.exec(`
      CREATE TABLE IF NOT EXISTS votes (
        user_id TEXT,
        producer_id INTEGER,
        PRIMARY KEY (user_id, producer_id)
      );
    `);
    
} catch (error) {
    console.error("Error en migración DB:", error);
}

function saveBase64Image(base64Data) {
    if (!base64Data) return null;
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;
    
    const type = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    const extension = type.split('/')[1];
    const fileName = `${crypto.randomUUID()}.${extension}`;
    const filePath = path.join(uploadsDir, fileName);
    
    fs.writeFileSync(filePath, buffer);
    return `/uploads/${fileName}`;
}

async function verifyGoogleToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No autenticado' });

    const token = authHeader.split(' ')[1];
    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: CLIENT_ID,
        });
        const payload = ticket.getPayload();
        
        const userStmt = db.prepare('SELECT * FROM users WHERE id = ?');
        let user = userStmt.get(payload['sub']);

        if (!user) {
             req.user = {
                id: payload['sub'],
                email: payload['email'],
                name: payload['name'],
                role: null,
                isNew: true
            };
        } else {
            req.user = {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                isNew: false
            };
        }
        next();
    } catch (error) {
        console.error("Error validando token:", error.message);
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
}

app.get('/api/config', (req, res) => {
    res.json({ googleClientId: CLIENT_ID || '' });
});

// Auth endpoints
app.post('/api/auth/login', verifyGoogleToken, (req, res) => {
    if (req.user.isNew) {
         const insert = db.prepare('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)');
         insert.run(req.user.id, req.user.email, req.user.name);
         
         return res.json({ 
             user: req.user, 
             requiresRoleSelection: true 
         });
    }
    
    if (!req.user.role) {
        return res.json({ 
             user: req.user, 
             requiresRoleSelection: true 
         });
    }

    res.json({ user: req.user, requiresRoleSelection: false });
});

app.post('/api/auth/role', verifyGoogleToken, [
    body('role').isIn(['farmer', 'consumer'])
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Rol inválido' });

    const { role } = req.body;
    const stmt = db.prepare('UPDATE users SET role = ? WHERE id = ?');
    stmt.run(role, req.user.id);
    
    res.json({ success: true, role });
});


app.get('/api/producers', (req, res) => {
    try {
        const stmt = db.prepare('SELECT * FROM producers');
        const producers = stmt.all();
        const parsedProducers = producers.map(p => ({
            ...p,
            products: p.products ? JSON.parse(p.products) : [],
            rating: p.rating_count > 0 ? (p.rating_sum / p.rating_count).toFixed(1) : 0,
            isOwner: false
        }));
        res.json(parsedProducers);
    } catch (error) {
        res.status(500).json({ error: 'Error interno' });
    }
});

// Create Producer
app.post('/api/producers', verifyGoogleToken, [
    body('name').trim().isLength({ min: 2, max: 50 }).escape(),
    body('phone').optional({ checkFalsy: true }).trim().isLength({ max: 20 }).escape(),
    body('web').optional({ checkFalsy: true }).trim().isURL(),
    body('lat').isFloat({ min: -90, max: 90 }),
    body('lng').isFloat({ min: -180, max: 180 }),
    body('icon').trim().escape(),
    body('color').trim().isHexColor(),
    body('products').isArray(),
    body('image').optional()
], (req, res) => {
    if (req.user.role !== 'farmer') {
        return res.status(403).json({ error: 'Solo los agricultores pueden crear huertos' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Datos inválidos', details: errors.array() });

    try {
        const { name, phone, web, products, lat, lng, icon, color, image } = req.body;
        const ownerId = req.user.id;

        let imagePath = null;
        if (image) {
            imagePath = saveBase64Image(image);
        }

        const stmt = db.prepare(`
            INSERT INTO producers (name, phone, web, products, lat, lng, icon, color, owner_id, image)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const sanitizedProducts = products.map(p => p.toString().substring(0, 50));

        const info = stmt.run(
            name, phone || '', web || '', JSON.stringify(sanitizedProducts), 
            lat, lng, icon || 'fi fi-sr-apple-whole', color || '#E74C3C', ownerId, imagePath
        );

        res.status(201).json({ id: info.lastInsertRowid, message: 'Productor registrado', image: imagePath });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al guardar' });
    }
});

// Update Producer
app.put('/api/producers/:id', verifyGoogleToken, [
    body('name').trim().isLength({ min: 2, max: 50 }).escape(),
    body('phone').optional({ checkFalsy: true }).trim().isLength({ max: 20 }).escape(),
    body('web').optional({ checkFalsy: true }).trim().isURL(),
    body('lat').isFloat({ min: -90, max: 90 }),
    body('lng').isFloat({ min: -180, max: 180 }),
    body('icon').trim().escape(),
    body('color').trim().isHexColor(),
    body('products').isArray(),
    body('image').optional()
], (req, res) => {
    const producerId = req.params.id;
    
    const checkStmt = db.prepare('SELECT owner_id, image FROM producers WHERE id = ?');
    const producer = checkStmt.get(producerId);
    
    if (!producer) return res.status(404).json({ error: 'Huerto no encontrado' });
    if (producer.owner_id !== req.user.id) return res.status(403).json({ error: 'No tienes permiso para editar este huerto' });

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Datos inválidos', details: errors.array() });

    try {
        const { name, phone, web, products, lat, lng, icon, color, image } = req.body;
        
        let imagePath = producer.image;
        if (image && image.startsWith('data:')) {
            if (producer.image && fs.existsSync(path.join(__dirname, producer.image))) {
                try { fs.unlinkSync(path.join(__dirname, producer.image)); } catch(e) {}
            }
            imagePath = saveBase64Image(image);
        }

        const stmt = db.prepare(`
            UPDATE producers 
            SET name = ?, phone = ?, web = ?, products = ?, lat = ?, lng = ?, icon = ?, color = ?, image = ?
            WHERE id = ?
        `);

        const sanitizedProducts = products.map(p => p.toString().substring(0, 50));

        stmt.run(
            name, phone || '', web || '', JSON.stringify(sanitizedProducts), 
            lat, lng, icon || 'fi fi-sr-apple-whole', color || '#E74C3C', imagePath, producerId
        );

        res.json({ message: 'Huerto actualizado', image: imagePath });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar' });
    }
});

// Delete Producer
app.delete('/api/producers/:id', verifyGoogleToken, (req, res) => {
    const producerId = req.params.id;
    
    const checkStmt = db.prepare('SELECT owner_id, image FROM producers WHERE id = ?');
    const producer = checkStmt.get(producerId);
    
    if (!producer) return res.status(404).json({ error: 'Huerto no encontrado' });
    if (producer.owner_id !== req.user.id) return res.status(403).json({ error: 'No tienes permiso para eliminar este huerto' });

    try {
        const stmt = db.prepare('DELETE FROM producers WHERE id = ?');
        stmt.run(producerId);
        
        if (producer.image) {
            const filePath = path.join(__dirname, producer.image);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        res.json({ message: 'Huerto eliminado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar' });
    }
});

app.post('/api/producers/:id/rate', verifyGoogleToken, [
    body('score').isInt({ min: 1, max: 5 })
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Puntuación inválida' });

    const producerId = req.params.id;
    const score = req.body.score;
    const userId = req.user.id;

    try {
        const transaction = db.transaction(() => {
            const checkVote = db.prepare('SELECT 1 FROM votes WHERE user_id = ? AND producer_id = ?');
            if (checkVote.get(userId, producerId)) {
                throw new Error('Ya has votado a este productor');
            }

            const insertVote = db.prepare('INSERT INTO votes (user_id, producer_id) VALUES (?, ?)');
            insertVote.run(userId, producerId);

            const updateProducer = db.prepare(`
                UPDATE producers 
                SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 
                WHERE id = ?
            `);
            const result = updateProducer.run(score, producerId);
            if (result.changes === 0) throw new Error('Productor no encontrado');
        });

        transaction();
        res.json({ message: 'Voto registrado' });

    } catch (error) {
        if (error.message === 'Ya has votado a este productor') {
            return res.status(409).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Backend corriendo en http://localhost:${port}`);
});