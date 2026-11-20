const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_EDGE = 2600;
const IMAGE_STORE = 'photos';
let connection;

function openStore() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('webapp-ahorro-photos', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IMAGE_STORE);
    request.onerror = () => reject(new Error('No se pudo abrir el almacenamiento de fotos.'));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        connection = null;
      };
      resolve(database);
    };
  }).catch((error) => {
    connection = null;
    throw error;
  });
  return connection;
}

export async function getPhoto(id) {
  const database = await openStore();
  return new Promise((resolve, reject) => {
    const request = database.transaction(IMAGE_STORE).objectStore(IMAGE_STORE).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('No se pudo leer la foto guardada.'));
  });
}

export async function writePhotos(photos = new Map(), remove = []) {
  const database = await openStore();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(IMAGE_STORE, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error('No se pudieron guardar los cambios de las fotos. Comprueba el espacio disponible en el navegador.'));
    const store = transaction.objectStore(IMAGE_STORE);
    for (const [id, blob] of photos) store.put(blob, id);
    for (const id of remove) store.delete(id);
  });
}

export const photoIds = (account) => account.movements.flatMap((entry) => entry.photoId ? [entry.photoId] : []);

function readImage(blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo abrir la imagen. Prueba con una foto JPG o PNG.'));
    image.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

export async function preparePhoto(file) {
  if (file.size > MAX_INPUT_BYTES) throw new Error('La foto supera los 30 MB. Elige una imagen más pequeña.');
  const image = await readImage(file);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo preparar la foto.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.88, 0.73, 0.55]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob?.type === 'image/jpeg' && blob.size <= MAX_PHOTO_BYTES) return blob;
  }
  throw new Error('No se pudo reducir el tamaño de la foto. Elige una imagen más pequeña.');
}

export function encodePhoto(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',', 2)[1]);
    reader.onerror = () => reject(new Error('No se pudo preparar la foto para la copia.'));
    reader.readAsDataURL(blob);
  });
}

export async function decodePhoto(encoded) {
  if (!encoded.startsWith('/9j/') || encoded.length > 4 * Math.ceil(MAX_PHOTO_BYTES / 3)) {
    throw new Error('La copia contiene una foto JPEG incorrecta o demasiado grande.');
  }
  let binary;
  try {
    binary = atob(encoded);
  } catch {
    throw new Error('La copia contiene una foto dañada.');
  }
  if (binary.length > MAX_PHOTO_BYTES || !binary.endsWith('\xff\xd9')) throw new Error('La copia contiene una foto dañada.');
  const blob = new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type: 'image/jpeg' });
  const image = await readImage(blob);
  if (Math.max(image.naturalWidth, image.naturalHeight) > MAX_EDGE) {
    throw new Error('La copia contiene una foto con dimensiones demasiado grandes.');
  }
  return blob;
}
