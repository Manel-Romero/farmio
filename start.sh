#!/bin/bash

cleanup() {
    echo "Deteniendo servicios..."
    kill $(jobs -p) 2>/dev/null
    exit
}

trap cleanup SIGINT

echo "Iniciando..."

if [ ! -d "node_modules" ]; then
    echo "Instalando dependencias..."
    npm install
fi

echo "Iniciando Servidor..."
node server.js &
SERVER_PID=$!

sleep 2

echo "Iniciando Cliente..."
npm run dev &
CLIENT_PID=$!

echo "Inicio exitoso."
echo "   - Backend: http://localhost:3001"
echo "   - Frontend: http://localhost:5173"
echo "Presiona Ctrl+C para detener."

wait $SERVER_PID $CLIENT_PID
