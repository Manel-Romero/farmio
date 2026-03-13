import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import './style.css';
import { iconClasses } from './icons.js';

const API_URL = '/api/producers';
let GOOGLE_CLIENT_ID = '';
let currentUser = null;
let currentProducers = [];

const map = L.map('map', {
    zoomControl: false,
    attributionControl: false
}).setView([40.416775, -3.703790], 13);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20
}).addTo(map);

let markers = [];
let isAddingMode = false;
let tempMarker = null;
let currentProducerId = null;

// DOM Elements
const sidebar = document.getElementById('sidebar');
const sbName = document.getElementById('sb-producer');
const sbPhone = document.getElementById('sb-phone');
const sbWeb = document.getElementById('sb-web');
const sbProducts = document.getElementById('sb-products');
const sbStars = document.getElementById('sb-stars');
const sbRatingVal = document.getElementById('sb-rating-val');
const sbRatingCount = document.getElementById('sb-rating-count');
const sbImageContainer = document.getElementById('sb-image-container');
const sbOwnerActions = document.getElementById('sb-owner-actions');
const btnEditProducer = document.getElementById('btn-edit-producer');
const btnDeleteProducer = document.getElementById('btn-delete-producer');

const voteStars = document.querySelectorAll('.vote-stars span');
const sbVoteActions = document.getElementById('sb-vote-actions');
const sbLoginMsg = document.getElementById('sb-login-msg');

const addProducerBtn = document.getElementById('add-producer-btn');
const producerFormContainer = document.getElementById('producer-form-container');
const newProducerForm = document.getElementById('new-producer-form');
const cancelFormBtn = document.getElementById('cancel-form-btn');
const iconGrid = document.getElementById('icon-grid');
const formIconInput = document.getElementById('form-icon-input');
const toast = document.getElementById('toast');
const formColor = document.getElementById('form-color');

// Image Upload Elements
const formImageInput = document.getElementById('form-image');
const uploadBtn = document.getElementById('upload-btn');
const imagePreview = document.getElementById('image-preview');
const locateBtn = document.getElementById('locate-btn');

// Modals
const roleModal = document.getElementById('role-modal');
const deleteModal = document.getElementById('delete-modal');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
const cancelDeleteBtn = document.getElementById('cancel-delete-btn');

// Auth & Init
async function initGoogleAuth() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        GOOGLE_CLIENT_ID = config.googleClientId;

        window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleCredentialResponse
        });

        window.google.accounts.id.renderButton(
            document.getElementById("google-login-btn"),
            { theme: "outline", size: "large", type: "standard" }
        );
        
    } catch (error) {
        console.error('Error inicializando Google Auth:', error);
    }
}

async function handleCredentialResponse(response) {
    const token = response.credential;
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        currentUser = { token, ...data.user };
        
        if (data.requiresRoleSelection) {
             roleModal.style.display = 'flex';
        } else {
             updateUI();
             showToast(`Bienvenido, ${currentUser.name}`);
        }
        document.getElementById("google-login-btn").style.display = 'none';
        
    } catch(e) { 
        console.error(e); 
        showToast('Error al iniciar sesión');
    }
}

// Role Selection
document.getElementById('role-farmer').onclick = () => selectRole('farmer');
document.getElementById('role-consumer').onclick = () => selectRole('consumer');

async function selectRole(role) {
    try {
        const res = await fetch('/api/auth/role', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUser.token}`
            },
            body: JSON.stringify({ role })
        });
        
        if (res.ok) {
            currentUser.role = role;
            roleModal.style.display = 'none';
            updateUI();
            showToast('Perfil actualizado');
        }
    } catch(e) {
        console.error(e);
        showToast('Error al actualizar perfil');
    }
}

function updateUI() {
    if (currentUser && currentUser.role === 'farmer') {
        addProducerBtn.style.display = 'block';
    } else {
        addProducerBtn.style.display = 'none';
    }
    
    // Refresh sidebar if open
    if (sidebar.classList.contains('open') && currentProducerId) {
        const p = currentProducers.find(p => p.id === currentProducerId);
        if (p) openSidebar(p);
    }
}

// Map Logic
function createIcon(iconClass, color) {
    return L.divIcon({
        className: 'custom-pin', 
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        html: `<i class="${iconClass}" style="color: ${color};"></i>`
    });
}

// Icon Grid
function renderIconGrid() {
    iconGrid.innerHTML = '';
    iconClasses.forEach(iconClass => {
        const div = document.createElement('div');
        div.className = 'icon-option';
        if (iconClass === formIconInput.value) div.classList.add('selected');
        
        const i = document.createElement('i');
        i.className = iconClass;
        div.appendChild(i);

        div.onclick = () => {
            document.querySelectorAll('.icon-option').forEach(el => el.classList.remove('selected'));
            div.classList.add('selected');
            formIconInput.value = iconClass;
        };
        iconGrid.appendChild(div);
    });
}
renderIconGrid();

function showToast(message) {
    toast.textContent = message;
    toast.className = 'toast show';
    setTimeout(() => { toast.className = toast.className.replace('show', ''); }, 3000);
}

function renderStars(rating) {
    const fullStars = Math.floor(rating);
    let html = '';
    for (let i = 0; i < fullStars; i++) html += '★';
    return html;
}

function openSidebar(producer) {
    if (isAddingMode) return;
    
    currentProducerId = producer.id;
    sbName.textContent = producer.name;
    sbPhone.textContent = producer.phone || 'No disponible';
    
    if (producer.web) {
        sbWeb.textContent = producer.web;
        sbWeb.href = producer.web;
        sbWeb.style.display = 'block';
    } else {
        sbWeb.style.display = 'none';
    }
    
    // Image
    sbImageContainer.innerHTML = '';
    if (producer.image) {
        const img = document.createElement('img');
        img.src = producer.image;
        sbImageContainer.appendChild(img);
    }
    
    sbStars.textContent = renderStars(producer.rating || 0);
    sbRatingVal.textContent = producer.rating || '0.0';
    sbRatingCount.textContent = `(${producer.rating_count || 0} votos)`;

    sbProducts.innerHTML = '';
    const productList = Array.isArray(producer.products) ? producer.products : [];
    if (productList.length > 0) {
        productList.forEach(prod => {
            const span = document.createElement('span');
            span.className = 'product-tag';
            span.textContent = prod.trim();
            sbProducts.appendChild(span);
        });
    } else {
        sbProducts.textContent = "Sin productos especificados";
    }

    // Owner Actions
    if (currentUser && producer.owner_id === currentUser.id) {
        sbOwnerActions.style.display = 'flex';
    } else {
        sbOwnerActions.style.display = 'none';
    }

    if (currentUser) {
        sbVoteActions.style.display = 'block';
        sbLoginMsg.style.display = 'none';
    } else {
        sbVoteActions.style.display = 'none';
        sbLoginMsg.style.display = 'block';
    }

    sidebar.classList.add('open');
}

// Edit/Delete Handlers
btnEditProducer.onclick = () => {
    const producer = currentProducers.find(p => p.id === currentProducerId);
    if (!producer) return;
    
    // Fill form
    document.getElementById('form-id').value = producer.id;
    document.getElementById('form-lat').value = producer.lat;
    document.getElementById('form-lng').value = producer.lng;
    document.getElementById('form-name').value = producer.name;
    document.getElementById('form-phone').value = producer.phone || '';
    document.getElementById('form-web').value = producer.web || '';
    document.getElementById('form-products').value = Array.isArray(producer.products) ? producer.products.join(', ') : '';
    document.getElementById('form-color').value = producer.color || '#E74C3C';
    
    formIconInput.value = producer.icon || 'fi fi-sr-apple-whole';
    renderIconGrid();

    // Image Preview
    if (producer.image) {
        imagePreview.innerHTML = `<img src="${producer.image}">`;
        imagePreview.classList.add('visible');
    } else {
        imagePreview.innerHTML = '';
        imagePreview.classList.remove('visible');
    }
    
    delete newProducerForm.dataset.imageData; // Clear any previous temp image
    document.getElementById('form-title').textContent = 'Editar Huerto';
    producerFormContainer.style.display = 'flex';
    sidebar.classList.remove('open');
};

btnDeleteProducer.onclick = () => {
    deleteModal.style.display = 'flex';
};

confirmDeleteBtn.onclick = async () => {
    try {
        const res = await fetch(`${API_URL}/${currentProducerId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${currentUser.token}` }
        });
        if (res.ok) {
            showToast('Huerto eliminado');
            deleteModal.style.display = 'none';
            sidebar.classList.remove('open');
            loadProducers();
        } else {
            showToast('Error al eliminar');
        }
    } catch(e) { showToast('Error de conexión'); }
};

cancelDeleteBtn.onclick = () => {
    deleteModal.style.display = 'none';
};

// Voting Logic
voteStars.forEach(star => {
    star.addEventListener('click', async () => {
        if (!currentProducerId) return;
        if (!currentUser) {
            showToast('Debes iniciar sesión con Google para votar');
            return;
        }

        const score = parseInt(star.getAttribute('data-score'));
        
        try {
            const response = await fetch(`${API_URL}/${currentProducerId}/rate`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUser.token}`
                },
                body: JSON.stringify({ score })
            });

            if (response.ok) {
                showToast('¡Voto registrado!');
                loadProducers(); 
            } else {
                const err = await response.json();
                showToast(err.error || 'Error al votar');
            }
        } catch (error) {
            showToast('Error de conexión');
        }
    });
    
    star.addEventListener('mouseover', () => {
        const score = parseInt(star.getAttribute('data-score'));
        voteStars.forEach((s, index) => {
            if (index < score) s.classList.add('hovered');
            else s.classList.remove('hovered');
        });
    });

    star.addEventListener('mouseout', () => {
        voteStars.forEach(s => s.classList.remove('hovered'));
    });
});

// Load Producers
async function loadProducers() {
    try {
        const response = await fetch(API_URL);
        currentProducers = await response.json();
        
        markers.forEach(m => map.removeLayer(m));
        markers = [];

        currentProducers.forEach(producer => {
            const marker = L.marker([producer.lat, producer.lng], { 
                icon: createIcon(producer.icon, producer.color) 
            });
            
            const stars = renderStars(producer.rating || 0);
            marker.bindPopup(`
                <div style="text-align: center;">
                    <b>${producer.name}</b><br>
                    <span style="color: #f1c40f;">${stars}</span>
                </div>
            `, { closeButton: false });
            
            marker.on('click', () => {
                openSidebar(producer);
            });

            markers.push(marker);
            marker.addTo(map);
        });
        
        // Refresh sidebar if open to show updated rating/data
        if (sidebar.classList.contains('open') && currentProducerId) {
            const updated = currentProducers.find(p => p.id === currentProducerId);
            if (updated) openSidebar(updated);
        }

    } catch (error) {
        console.error(error);
        showToast('Error conectando con el servidor');
    }
}

// Add Producer Logic
addProducerBtn.addEventListener('click', () => {
    if (!currentUser || currentUser.role !== 'farmer') {
        showToast('Solo los agricultores pueden añadir huertos');
        return;
    }
    
    isAddingMode = !isAddingMode;
    if (isAddingMode) {
        addProducerBtn.classList.add('active');
        addProducerBtn.innerHTML = '<i class="fi fi-sr-cross"></i> Cancelar';
        showToast('Haz clic en el mapa para añadir tu huerto');
        sidebar.classList.remove('open');
    } else {
        disableAddingMode();
    }
});

function disableAddingMode() {
    isAddingMode = false;
    addProducerBtn.classList.remove('active');
    addProducerBtn.innerHTML = '<i class="fi fi-sr-plus"></i> Añadir Huerto';
    if (tempMarker) {
        map.removeLayer(tempMarker);
        tempMarker = null;
    }
    producerFormContainer.style.display = 'none';
}

map.on('click', (e) => {
    if (!isAddingMode) {
        if (!e.originalEvent.target.closest('.leaflet-marker-icon')) {
            sidebar.classList.remove('open');
        }
        return;
    }

    const { lat, lng } = e.latlng;
    
    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = L.marker([lat, lng]).addTo(map);

    // Prepare form for new entry
    newProducerForm.reset();
    document.getElementById('form-id').value = '';
    document.getElementById('form-lat').value = lat;
    document.getElementById('form-lng').value = lng;
    document.getElementById('form-title').textContent = 'Registrar Nuevo Huerto';
    imagePreview.innerHTML = '';
    imagePreview.classList.remove('visible');
    delete newProducerForm.dataset.imageData;
    
    producerFormContainer.style.display = 'flex';
});

cancelFormBtn.addEventListener('click', () => {
    producerFormContainer.style.display = 'none';
    if (tempMarker && isAddingMode) {
        map.removeLayer(tempMarker);
        tempMarker = null;
    }
});

// Image Upload Handling
uploadBtn.onclick = () => formImageInput.click();

formImageInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const compressedBase64 = await compressImage(file);
        // Show preview
        imagePreview.innerHTML = `<img src="${compressedBase64}">`;
        imagePreview.classList.add('visible');
        newProducerForm.dataset.imageData = compressedBase64;
    } catch (err) {
        console.error(err);
        showToast('Error al procesar la imagen');
    }
};

function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const maxSize = 720;
                
                if (width > height) {
                    if (width > maxSize) {
                        height *= maxSize / width;
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width *= maxSize / height;
                        height = maxSize;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

// Form Submit
newProducerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const formData = new FormData(newProducerForm);
    const id = formData.get('id');
    const isEdit = !!id;
    
    const data = {
        name: formData.get('name'),
        phone: formData.get('phone'),
        web: formData.get('web'),
        products: formData.get('products').split(',').filter(p => p.trim() !== ''),
        icon: formData.get('icon'),
        color: formData.get('color'),
        lat: parseFloat(formData.get('lat')),
        lng: parseFloat(formData.get('lng')),
        image: newProducerForm.dataset.imageData || null
    };

    const url = isEdit ? `${API_URL}/${id}` : API_URL;
    const method = isEdit ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUser.token}`
            },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            showToast(isEdit ? 'Huerto actualizado' : 'Huerto registrado');
            producerFormContainer.style.display = 'none';
            newProducerForm.reset();
            delete newProducerForm.dataset.imageData;
            
            disableAddingMode();
            loadProducers();
        } else {
            const err = await response.json();
            showToast('Error: ' + (err.error || 'Datos inválidos'));
        }
    } catch (error) {
        showToast('Error al guardar');
    }
});

formColor.addEventListener('input', (e) => {
    const color = e.target.value;
    document.querySelectorAll('.icon-option i').forEach(icon => {
        icon.style.color = color;
    });
});

let userLocationMarker = null;

// Geolocation
function locateUser() {
    if (!navigator.geolocation) {
        showToast('Geolocalización no soportada por tu navegador');
        return;
    }

    showToast('Obteniendo ubicación...');
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            map.setView([latitude, longitude], 13);
            
            if (userLocationMarker) {
                map.removeLayer(userLocationMarker);
            }

            userLocationMarker = L.circleMarker([latitude, longitude], {
                radius: 8,
                fillColor: "#3498db",
                color: "#fff",
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(map).bindPopup("Estás aquí");
            
            userLocationMarker.openPopup();
            showToast('Ubicación encontrada');
        },
        (error) => {
            console.error(error);
            showToast('No se pudo obtener la ubicación. Activa el GPS.');
        },
        { enableHighAccuracy: true, timeout: 5000 }
    );
}

locateBtn.addEventListener('click', locateUser);

initGoogleAuth();
loadProducers();
// Try to locate on start
locateUser();