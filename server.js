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
app.use(express.json({ limit: '50mb' }));
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
        images TEXT,
        description TEXT,
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
    if (!colNames.includes('images')) db.prepare("ALTER TABLE producers ADD COLUMN images TEXT").run();
    if (!colNames.includes('description')) db.prepare("ALTER TABLE producers ADD COLUMN description TEXT").run();

    db.exec(`
      CREATE TABLE IF NOT EXISTS votes (
        user_id TEXT,
        producer_id INTEGER,
        score INTEGER,
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, producer_id)
      );
    `);
    
    // Check if votes table needs migration
    const voteColumns = db.prepare("PRAGMA table_info(votes)").all();
    const voteColNames = voteColumns.map(c => c.name);
    if (!voteColNames.includes('comment')) db.prepare("ALTER TABLE votes ADD COLUMN comment TEXT").run();
    if (!voteColNames.includes('score')) db.prepare("ALTER TABLE votes ADD COLUMN score INTEGER").run();
    if (!voteColNames.includes('created_at')) {
        // SQLite doesn't support adding a column with CURRENT_TIMESTAMP default easily in ALTER TABLE
        // So we add it without default and update existing rows
        db.prepare("ALTER TABLE votes ADD COLUMN created_at DATETIME").run();
        db.prepare("UPDATE votes SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL").run();
    }

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
            images: p.images ? JSON.parse(p.images) : (p.image ? [p.image] : []),
            rating: p.rating_count > 0 ? (p.rating_sum / p.rating_count).toFixed(1) : 0,
            isOwner: false
        }));
        res.json(parsedProducers);
    } catch (error) {
        console.error(error);
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
    body('description').optional().trim().escape(),
    body('images').optional().isArray()
], (req, res) => {
    if (req.user.role !== 'farmer') {
        return res.status(403).json({ error: 'Solo los agricultores pueden crear huertos' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Datos inválidos', details: errors.array() });

    try {
        const { name, phone, web, products, lat, lng, icon, color, images, description } = req.body;
        const ownerId = req.user.id;

        let savedImages = [];
        if (images && Array.isArray(images)) {
            savedImages = images.map(img => saveBase64Image(img)).filter(p => p !== null);
        }

        const stmt = db.prepare(`
            INSERT INTO producers (name, phone, web, products, lat, lng, icon, color, owner_id, images, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const sanitizedProducts = products.map(p => p.toString().substring(0, 50));

        const info = stmt.run(
            name, phone || '', web || '', JSON.stringify(sanitizedProducts), 
            lat, lng, icon || 'fi fi-sr-apple-whole', color || '#E74C3C', ownerId, JSON.stringify(savedImages), description || ''
        );

        res.status(201).json({ id: info.lastInsertRowid, message: 'Productor registrado', images: savedImages });
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
    body('description').optional().trim().escape(),
    body('images').optional().isArray()
], (req, res) => {
    const producerId = req.params.id;
    
    const checkStmt = db.prepare('SELECT owner_id, images, image FROM producers WHERE id = ?');
    const producer = checkStmt.get(producerId);
    
    if (!producer) return res.status(404).json({ error: 'Huerto no encontrado' });
    if (producer.owner_id !== req.user.id) return res.status(403).json({ error: 'No tienes permiso para editar este huerto' });

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Datos inválidos', details: errors.array() });

    try {
        const { name, phone, web, products, lat, lng, icon, color, images, description } = req.body;
        
        let currentImages = producer.images ? JSON.parse(producer.images) : (producer.image ? [producer.image] : []);
        let newImagesPaths = [];

        if (images && Array.isArray(images)) {
             images.forEach(img => {
                 if (img.startsWith('data:')) {
                     const path = saveBase64Image(img);
                     if (path) newImagesPaths.push(path);
                 } else if (img.startsWith('/uploads/')) {
                     newImagesPaths.push(img);
                 }
             });
        }
        
        // Find deleted images to cleanup fs
        const deletedImages = currentImages.filter(img => !newImagesPaths.includes(img));
        deletedImages.forEach(img => {
             const p = path.join(__dirname, img);
             if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch(e) {}
        });

        const stmt = db.prepare(`
            UPDATE producers 
            SET name = ?, phone = ?, web = ?, products = ?, lat = ?, lng = ?, icon = ?, color = ?, images = ?, description = ?
            WHERE id = ?
        `);

        const sanitizedProducts = products.map(p => p.toString().substring(0, 50));

        stmt.run(
            name, phone || '', web || '', JSON.stringify(sanitizedProducts), 
            lat, lng, icon || 'fi fi-sr-apple-whole', color || '#E74C3C', JSON.stringify(newImagesPaths), description || '', producerId
        );

        res.json({ message: 'Huerto actualizado', images: newImagesPaths });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar' });
    }
});

// Delete Producer
app.delete('/api/producers/:id', verifyGoogleToken, (req, res) => {
    const producerId = req.params.id;
    
    const checkStmt = db.prepare('SELECT owner_id, images, image FROM producers WHERE id = ?');
    const producer = checkStmt.get(producerId);
    
    if (!producer) return res.status(404).json({ error: 'Huerto no encontrado' });
    if (producer.owner_id !== req.user.id) return res.status(403).json({ error: 'No tienes permiso para eliminar este huerto' });

    try {
        const stmt = db.prepare('DELETE FROM producers WHERE id = ?');
        stmt.run(producerId);
        
        let imagesToDelete = producer.images ? JSON.parse(producer.images) : (producer.image ? [producer.image] : []);
        imagesToDelete.forEach(img => {
            const filePath = path.join(__dirname, img);
            if (fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch(e) {}
            }
        });

        res.json({ message: 'Huerto eliminado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar' });
    }
});

app.post('/api/producers/:id/rate', verifyGoogleToken, [
    body('score').isInt({ min: 1, max: 5 }),
    body('comment').optional().trim().escape()
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Datos inválidos' });

    const producerId = req.params.id;
    const { score, comment } = req.body;
    const userId = req.user.id;

    try {
        const transaction = db.transaction(() => {
            const checkVote = db.prepare('SELECT 1 FROM votes WHERE user_id = ? AND producer_id = ?');
            if (checkVote.get(userId, producerId)) {
                throw new Error('Ya has votado a este productor');
            }

            const insertVote = db.prepare('INSERT INTO votes (user_id, producer_id, score, comment) VALUES (?, ?, ?, ?)');
            insertVote.run(userId, producerId, score, comment || '');

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

// Get Reviews
app.get('/api/producers/:id/reviews', (req, res) => {
    const producerId = req.params.id;
    try {
        const stmt = db.prepare(`
            SELECT v.score, v.comment, v.created_at, u.name as user_name 
            FROM votes v 
            LEFT JOIN users u ON v.user_id = u.id 
            WHERE v.producer_id = ? 
            ORDER BY v.created_at DESC
        `);
        const reviews = stmt.all(producerId);
        res.json(reviews);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error obteniendo reseñas' });
    }
});

app.listen(port, () => {
    console.log(`Backend corriendo en http://localhost:${port}`);
});