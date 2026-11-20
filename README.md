# Aparta

Aplicación estática de Astro para registrar ingresos y gastos, calcular el ahorro y reservar dinero para objetivos. La interfaz y los importes usan español y euros.

[Abrir Aparta](https://suliaragon.github.io/AhorroWebApp/)

## Desarrollo local

Requiere Node.js 22.12 o superior.

```sh
npm ci
npm run dev
```

Astro muestra la URL local en la terminal. Para comprobar la instalación de la PWA y el modo sin conexión, sirve la compilación de producción:

```sh
npm run build
npm run preview
```

La primera visita requiere conexión para descargar la app en el navegador. Después, puedes instalarla desde el menú del navegador o el botón **Instalar app**.

En **Inicio** tienes el saldo total, los ingresos, los gastos y los movimientos con sus signos. El botón **+** abre el registro y en **Historial** puedes buscar todos los movimientos. La fecha, la categoría y la foto de cada movimiento se editan en **Más detalles**. **Análisis** muestra las entradas, los gastos y el ahorro de cada mes. El tema se cambia desde la cabecera. En **Ajustes** puedes editar el ahorro inicial o abrir las copias CSV.

Las categorías Consola, Juegos, Viajes y Ordenador usan SVG locales de [Tabler Icons](https://github.com/tabler/tabler-icons), con [licencia MIT](public/licenses/tabler-icons.txt).

## Saldo y conceptos

El gráfico de **Historial** muestra los ingresos y gastos por categoría. El selector de categoría y los filtros de búsqueda, tipo y mes se aplican tanto al gráfico como a la lista.

- El saldo total suma el ahorro inicial, los depósitos y los ingresos, y resta los gastos.
- Toca **Ingresos** o un movimiento para abrir el detalle de un concepto. Al registrar un ingreso puedes reutilizar un concepto existente o escribir uno nuevo.
- **Destinado** indica lo que queda tras restar los gastos a los ingresos del mismo concepto. Las reservas de versiones anteriores se incluyen en el detalle y se pueden gestionar desde allí.
- Usa **Fijar precio objetivo** en la ficha de un concepto para ver cuánto has ahorrado y cuánto te falta. Puedes editar el precio o dejar el campo vacío para quitarlo.
- Si registras un extracto bancario, indica como ahorro inicial el importe de partida justo antes del primer movimiento del extracto.

## Copias CSV

**Exportar mi cuenta** descarga un CSV con el ahorro inicial, los movimientos, los objetivos, las aportaciones y los precios objetivo. Importar este CSV restaura la cuenta completa, previa confirmación.

Cada gasto admite una foto opcional. Puedes hacerla con la cámara del móvil o elegir una imagen ya guardada. El importe se introduce manualmente. La app reduce la imagen a JPEG y la guarda en IndexedDB en el dispositivo. Abre la foto desde **Movimientos** o edita el gasto para sustituirla o quitarla.

**Descargar con fotos** incluye los adjuntos dentro del CSV. Esta opción aparece al guardar la primera foto y admite copias de hasta 64 MB. Puedes restaurarlas en otro navegador con Aparta. Guarda estas copias en privado.

Puedes importar un extracto bancario con cabecera y delimitador de punto y coma, coma o tabulación. Selecciona fecha, concepto e importe. Se admite una columna de importes con signo o dos columnas separadas para cargos y abonos. Las fechas pueden estar en formato `AAAA-MM-DD` o `DD/MM/AAAA`. La revisión indica los movimientos nuevos, duplicados y filas inválidas. La detección de duplicados compara la fecha, el concepto y el importe de los movimientos ya importados y tiene en cuenta cuántas veces aparecen en el archivo.

Tu cuenta se guarda en el navegador, por sitio y por perfil. Para cambiar de dispositivo o de dirección web, exporta un CSV de tu cuenta e impórtalo en el destino. Guarda estos archivos en privado y fuera del repositorio.

## Publicación estática

GitHub Actions compila y publica la app en GitHub Pages con cada cambio en `main`. El flujo usa la ruta que indica GitHub Pages para que el manifiesto, los iconos y el modo sin conexión funcionen en la subruta del repositorio.

El directorio generado por `npm run build` es `dist/`. Si se sirve bajo una subruta de GitHub Pages, por ejemplo `https://usuario.github.io/repositorio/`, usa:

```sh
WEBAPP_BASE=/repositorio/ npm run build
```

Para dominios raíz usa `npm run build` sin definir `WEBAPP_BASE`.
