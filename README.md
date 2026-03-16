# Farmio

## Requisitos previos

- Node.js (versión 16 o superior recomendada)
- NPM (incluido con Node.js)

### Linux (Ubuntu/Debian)
Es posible que necesites herramientas de compilación para la base de datos SQLite:
```bash
sudo apt-get install build-essential
```

## Instalación

1. Clona el repositorio o descarga el código.
2. Abre una terminal en la carpeta del proyecto.
3. Instala las dependencias:

```bash
npm install
```

## Configuración

Añade tu ID de cliente de Google en el `.env`:

```env
GOOGLE_CLIENT_ID=tu_google_client_id_aqui
```

## Ejecución

```bash
npm run dev
```

- El **Frontend** estará disponible en `http://localhost:5173`.
- El **Backend** estará corriendo internamente en `http://localhost:3001`.

Para ejecutarlos por separado, usar:
- `npm run server` para iniciar solo el backend.
- `npx vite` para iniciar solo el frontend.

## Estructura del Proyecto

- `server.js`: Servidor Backend.
- `src/`: Código fuente del Frontend.
- `farmio.db`: Base de datos SQLite.
- `uploads/`: Carpeta para imágenes subidas.
