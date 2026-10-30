/* =========================================================
   MicroLink - Lógica de la aplicación (JavaScript puro)
   - Navegación entre los 5 módulos
   - Consulta periódica al backend con Fetch API
   - Modo demostración cuando el backend no está disponible
   - Modo Demo manual con popup de confirmación del usuario
   - Gráficas de temperatura con Chart.js
   - Animaciones: números animados, tiempos relativos,
     destello en alertas nuevas
   ========================================================= */

/* ---------------------------------------------------------
   1. CONFIGURACIÓN Y ESTADO
--------------------------------------------------------- */

// Direcciones de las rutas del backend
const API = {
    estado: "/api/estado",
    mensajes: "/api/mensajes",
    alertas: "/api/alertas",
    temperatura: "/api/temperatura",
    dispositivosSerial: "/api/dispositivos-serial",
    conectar: "/api/conectar"
};

const INTERVALO_ACTUALIZACION = 3000; // 3 segundos entre consultas

// Estado de la aplicación
let modoDemo = true;          // true = se muestran datos de demostración
let demoManual = false;       // true = el usuario activó el Modo Demo a mano
let mensajes = [];            // todos los mensajes recibidos
let alertas = [];             // mensajes que representan alertas
let serieTemperatura = [];    // puntos para la gráfica
let estado = { usb_conectado: false, puerto: null };

// Filtros y rangos elegidos por el usuario
let filtroAlertas = "todas";
let filtroHistorial = "TODOS";
let rangoMinutos = 10;

// Control para animar solo lo que cambia
let ultimoIdAlertaVista = 0;
let primeraCarga = true;
let temperaturaAnterior = null;

/* ---------------------------------------------------------
   2. UTILIDADES DE TIEMPO
--------------------------------------------------------- */

function rellenar(n) { return String(n).padStart(2, "0"); }

// Numeración de filas en las tablas (001, 002, ...)
function numero(i) { return String(i).padStart(3, "0"); }

// Convierte "dd/mm/yyyy HH:MM:SS" en marca de tiempo (ms)
function parseFecha(texto) {
    const m = String(texto).match(
        /(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return Date.now();
    return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime();
}

// Devuelve texto legible: "Hace 5 segundos", "Hace 2 minutos"...
function haceCuanto(ms) {
    const seg = Math.round((Date.now() - ms) / 1000);
    if (seg < 5) return "Ahora mismo";
    if (seg < 60) return "Hace " + seg + " segundos";
    const min = Math.round(seg / 60);
    if (min < 60) return "Hace " + min + (min === 1 ? " minuto" : " minutos");
    const hora = Math.round(min / 60);
    if (hora < 24) return "Hace " + hora + (hora === 1 ? " hora" : " horas");
    const dia = Math.round(hora / 24);
    return "Hace " + dia + (dia === 1 ? " día" : " días");
}

// Reloj de la barra superior y textos con "hace X tiempo"
function actualizarRelojes() {
    const ahora = new Date();
    document.getElementById("fecha-hoy").textContent =
        ahora.toLocaleDateString("es-CO",
            { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    document.getElementById("hora-actual").textContent =
        ahora.toLocaleTimeString("es-CO", { hour12: true });

    document.querySelectorAll("[data-ts]").forEach(el => {
        el.textContent = haceCuanto(Number(el.dataset.ts));
    });
}

/* ---------------------------------------------------------
   3. ANIMACIÓN DE NÚMEROS (conteo progresivo)
--------------------------------------------------------- */

function animarNumero(elemento, destino, sufijo) {
    sufijo = sufijo || "";
    const actual = parseFloat(String(elemento.textContent).replace(/[^\d.-]/g, "")) || 0;
    if (actual === destino) {
        elemento.textContent = destino + sufijo;
        return;
    }
    const inicio = performance.now();
    const duracion = 550;

    function paso(momento) {
        const avance = Math.min((momento - inicio) / duracion, 1);
        const suave = 1 - Math.pow(1 - avance, 3); // ease-out
        const valor = Math.round(actual + (destino - actual) * suave);
        elemento.textContent = valor + sufijo;
        if (avance < 1) requestAnimationFrame(paso);
    }
    requestAnimationFrame(paso);
}

/* ---------------------------------------------------------
   4. DATOS DE DEMOSTRACIÓN
   Se usan únicamente mientras no hay hardware conectado.
--------------------------------------------------------- */

let mensajesDemo = [];

// Formato de fecha idéntico al que genera el backend
function fechaTexto(fecha) {
    return rellenar(fecha.getDate()) + "/" + rellenar(fecha.getMonth() + 1) +
           "/" + fecha.getFullYear() + " " + rellenar(fecha.getHours()) +
           ":" + rellenar(fecha.getMinutes()) + ":" + rellenar(fecha.getSeconds());
}

// Crea un mensaje de demostración con la misma estructura real
function crearMensajeDemo(fecha) {
    const valido = Math.random() > 0.15; // 85% de mensajes válidos

    // Temperatura con un comportamiento parecido a un ambiente real
    const anteriores = mensajesDemo.filter(m => m.estado === "VALIDO");
    let temperatura = anteriores.length ? Number(anteriores[anteriores.length - 1].valor) : 26;
    temperatura += (Math.random() - 0.5) * 1.7;
    temperatura = Math.max(18, Math.min(35, temperatura));

    return {
        id: mensajesDemo.length + 1,
        id_emisor: "USR_01",
        tipo_alerta: "TEMP",
        valor: temperatura.toFixed(0),
        clave_recibida: valido ? "SEC123" : "SEC999",
        estado: valido ? "VALIDO" : "RECHAZADO",
        fecha_hora: fechaTexto(fecha)
    };
}

// Genera la serie inicial de demostración (últimos 10 minutos)
function iniciarDemo() {
    const base = Date.now() - 1000 * 60 * 10;
    for (let i = 0; i < 11; i++) {
        mensajesDemo.push(crearMensajeDemo(new Date(base + i * 60000)));
    }
    sincronizarDemo();
}

// Agrega un nuevo mensaje de demostración en cada ciclo
function avanzarDemo() {
    mensajesDemo.push(crearMensajeDemo(new Date()));
    if (mensajesDemo.length > 80) mensajesDemo.shift(); // limitar memoria
    sincronizarDemo();
}

function sincronizarDemo() {
    mensajes = mensajesDemo.slice();
    alertas = mensajes.slice();
    serieTemperatura = mensajes
        .filter(m => m.tipo_alerta === "TEMP" && m.estado === "VALIDO")
        .map(m => ({ fecha_hora: m.fecha_hora, valor: Number(m.valor) }));
    // El estado de conexión NUNCA se simula: siempre refleja el sistema real
}

/* ---------------------------------------------------------
   5. CONSULTA AL BACKEND (Fetch API)
--------------------------------------------------------- */

async function obtenerJson(url) {
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error("Error en " + url);
    return respuesta.json();
}

// Consulta las cuatro rutas del backend. Si ninguna responde,
// se activa el modo de demostración.
async function actualizarDatos() {
    // Modo Demo activado a mano: se muestran datos ficticios aunque el
    // backend esté respondiendo (el estado real de conexión no se toca)
    if (demoManual) {
        modoDemo = true;
        avanzarDemo();
        pintarTodo();
        return;
    }

    try {
        const [rEstado, rMensajes, rAlertas, rTemperatura] = await Promise.all([
            obtenerJson(API.estado),
            obtenerJson(API.mensajes),
            obtenerJson(API.alertas),
            obtenerJson(API.temperatura)
        ]);

        // Se recibieron datos reales: se desactiva la demostración
        modoDemo = false;
        estado = rEstado;
        mensajes = rMensajes;
        alertas = rAlertas;
        serieTemperatura = rTemperatura.serie || [];

    } catch (error) {
        // El backend no responde: se usan datos de demostración y
        // no puede verificarse ninguna conexión USB
        modoDemo = true;
        estado = { usb_conectado: false, puerto: null };
        avanzarDemo();
    }

    pintarTodo();
}

/* ---------------------------------------------------------
   6. NAVEGACIÓN ENTRE MÓDULOS
--------------------------------------------------------- */

function irAModulo(modulo) {
    document.querySelectorAll(".menu-item")
        .forEach(b => b.classList.toggle("active", b.dataset.modulo === modulo));

    document.querySelectorAll(".modulo")
        .forEach(m => m.classList.remove("activo"));
    document.getElementById("modulo-" + modulo).classList.add("activo");
}

function configurarNavegacion() {
    document.querySelectorAll(".menu-item").forEach(boton => {
        boton.addEventListener("click", () => irAModulo(boton.dataset.modulo));
    });

    // Botones "Ver todos" que abren el módulo completo
    document.querySelectorAll("[data-ir]").forEach(boton => {
        boton.addEventListener("click", () => irAModulo(boton.dataset.ir));
    });
}

/* ---------------------------------------------------------
   7. GRÁFICAS (Chart.js)
--------------------------------------------------------- */

let graficaDashboard = null;
let graficaCompleta = null;
let fechasVisibles = [];     // fechas de los puntos mostrados

function crearGradiente(canvas, alto) {
    const ctx = canvas.getContext("2d");
    const gradiente = ctx.createLinearGradient(0, 0, 0, alto);
    gradiente.addColorStop(0, "rgba(59, 130, 246, 0.28)");
    gradiente.addColorStop(1, "rgba(59, 130, 246, 0.00)");
    return gradiente;
}

function opcionesGraficas() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700, easing: "easeOutQuart" },
        interaction: { mode: "index", intersect: false },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: "#ffffff",
                borderColor: "#e6ecf7",
                borderWidth: 1,
                titleColor: "#64748b",
                titleFont: { size: 11, weight: "600" },
                bodyColor: "#0f172a",
                bodyFont: { size: 14, weight: "700" },
                padding: 11,
                cornerRadius: 12,
                caretSize: 6,
                displayColors: false,
                callbacks: {
                    title: items => fechasVisibles[items[0].dataIndex] || "",
                    label: ctx => " " + ctx.parsed.y + " °C"
                }
            }
        },
        scales: {
            x: {
                grid: { display: false },
                border: { display: false },
                ticks: { color: "#94a3b8", font: { size: 11 }, maxTicksLimit: 8, maxRotation: 0 }
            },
            y: {
                min: 15,
                max: 40,
                grid: { color: "#eef2f8" },
                border: { display: false },
                ticks: {
                    color: "#94a3b8",
                    font: { size: 11 },
                    stepSize: 5,
                    callback: valor => valor + "°"
                },
                title: {
                    display: true,
                    text: "Temperatura (°C)",
                    color: "#94a3b8",
                    font: { size: 11, weight: "600" }
                }
            }
        }
    };
}

function crearGraficas() {
    const base = {
        labels: [],
        datasets: [{
            label: "Temperatura",
            data: [],
            borderColor: "#3b82f6",
            borderWidth: 2.5,
            fill: true,
            tension: .4,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: "#ffffff",
            pointHoverBorderColor: "#3b82f6",
            pointHoverBorderWidth: 3
        }]
    };

    graficaDashboard = new Chart(
        document.getElementById("grafica-dashboard"),
        { type: "line", data: base, options: opcionesGraficas() });
    graficaDashboard.data.datasets[0].backgroundColor =
        crearGradiente(document.getElementById("grafica-dashboard"), 265);

    const base2 = JSON.parse(JSON.stringify(base));
    graficaCompleta = new Chart(
        document.getElementById("grafica-temperatura"),
        { type: "line", data: base2, options: opcionesGraficas() });
    graficaCompleta.data.datasets[0].backgroundColor =
        crearGradiente(document.getElementById("grafica-temperatura"), 440);
}

// Filtra la serie según el rango elegido y devuelve etiquetas
function prepararSerie() {
    const ahora = Date.now();
    let puntos = serieTemperatura.map(p => ({
        ts: parseFecha(p.fecha_hora),
        fecha: p.fecha_hora,
        valor: p.valor
    }));

    if (rangoMinutos > 0) {
        const limite = ahora - rangoMinutos * 60000;
        puntos = puntos.filter(p => p.ts >= limite);
    }
    return puntos.slice(-200);
}

function pintarGraficas() {
    if (!graficaDashboard) return;

    const puntos = prepararSerie();
    fechasVisibles = puntos.map(p => p.fecha);
    const etiquetas = puntos.map(p => p.fecha.split(" ")[1]?.slice(0, 5) || p.fecha);
    const valores = puntos.map(p => p.valor);

    // Rango vertical adaptado a los datos
    let min = 15, max = 40;
    if (valores.length) {
        min = Math.floor(Math.min(...valores) - 2);
        max = Math.ceil(Math.max(...valores) + 2);
        if (max - min < 8) { min -= 2; max += 2; }
    }

    [graficaDashboard, graficaCompleta].forEach(g => {
        g.data.labels = etiquetas;
        g.data.datasets[0].data = valores;
        g.options.scales.y.min = min;
        g.options.scales.y.max = max;
        g.update();
    });
}

function configurarRangos() {
    document.querySelectorAll("[data-rango]").forEach(select => {
        select.addEventListener("change", () => {
            rangoMinutos = Number(select.value);
            // se sincronizan los dos selectores
            document.querySelectorAll("[data-rango]").forEach(s => s.value = select.value);
            pintarGraficas();
        });
    });
}

/* ---------------------------------------------------------
   8. PIEZAS DE INTERFAZ (HTML generado)
--------------------------------------------------------- */

function etiquetaEstado(estadoMensaje) {
    if (estadoMensaje === "VALIDO") {
        return '<span class="estado estado-valido">' +
               '<svg><use href="#i-check"/></svg>Válido</span>';
    }
    return '<span class="estado estado-rechazado">' +
           '<svg><use href="#i-x"/></svg>Rechazado</span>';
}

function chipTipo(tipo) {
    if (tipo === "TEMP") return '<span class="chip-tipo chip-temp">TEMP</span>';
    if (tipo === "INVALIDO") return '<span class="chip-tipo chip-invalido">INVALIDO</span>';
    return '<span class="chip-tipo chip-otro">' + tipo + "</span>";
}

function nombreTipo(tipo) {
    if (tipo === "TEMP") return "TEMPERATURA";
    if (tipo === "INVALIDO") return "MENSAJE INVÁLIDO";
    return tipo;
}

// Fila de alerta usada en el dashboard y en el módulo de alertas
function filaAlerta(a, esNueva, conEstado) {
    const rechazada = a.estado === "RECHAZADO";
    const icono = a.tipo_alerta === "TEMP"
        ? '<div class="alerta-icono azul"><svg><use href="#i-thermo"/></svg></div>'
        : '<div class="alerta-icono gris"><svg><use href="#i-xc"/></svg></div>';
    const claseValor = a.tipo_alerta === "TEMP" ? "azul" : "gris";
    // El módulo de alertas muestra además el estado de validación
    const estadoHtml = conEstado ? etiquetaEstado(a.estado) : "";

    return `
        <div class="alerta-fila ${rechazada ? "destacada" : ""} ${esNueva ? "nueva" : ""}">
            ${icono}
            <div class="alerta-info">
                <strong>${nombreTipo(a.tipo_alerta)}</strong>
                <span>${a.id_emisor} · <span data-ts="${parseFecha(a.fecha_hora)}">…</span></span>
            </div>
            ${estadoHtml}
            <span class="valor-pill ${claseValor}">${a.valor}${a.tipo_alerta === "TEMP" ? " °C" : ""}</span>
        </div>`;
}

// Pinta un contenedor solo si su contenido cambió (evita parpadeos)
function pintarSiCambio(elemento, html) {
    if (elemento.dataset.hash === html) return false;
    elemento.innerHTML = html;
    elemento.dataset.hash = html;
    return true;
}

/* ---------------------------------------------------------
   9. PINTAR LA INTERFAZ
--------------------------------------------------------- */

function pintarConexion() {
    // Con el Modo Demo activo no se afirma nada sobre los datos:
    // todo lo que se ve es simulado y así se indica en cada indicador
    const enDemo = demoManual;
    const conectado = estado.usb_conectado;
    const texto = enDemo
        ? "Modo demo · datos simulados"
        : conectado ? "Conectado al receptor (USB)" : "Receptor USB sin conexión";

    // Píldora de la barra superior
    const pill = document.getElementById("pill-usb");
    pill.classList.toggle("conectado", conectado && !enDemo);
    pill.classList.toggle("demo", enDemo);
    document.getElementById("pill-punto").className =
        "punto " + (enDemo ? "punto-demo" : conectado ? "punto-on" : "punto-off");
    document.getElementById("pill-texto").textContent = texto;

    // Tarjeta inferior del menú lateral
    const lateral = document.getElementById("sidebar-estado");
    lateral.classList.toggle("conectado", conectado && !enDemo);
    lateral.classList.toggle("demo", enDemo);
    document.getElementById("estado-punto").className =
        "punto " + (enDemo ? "punto-demo" : conectado ? "punto-on" : "punto-off");
    document.getElementById("estado-titulo").textContent =
        enDemo ? "Modo demostración"
               : conectado ? "Sistema conectado" : "Sistema sin USB";
    document.getElementById("estado-sub").textContent =
        enDemo ? "Datos ficticios de ejemplo"
               : conectado ? (modoDemo ? "Modo demostración" : "Recibiendo datos por USB")
                           : "Esperando al receptor";

    // Ecualizador del logo: animado mientras haya datos entrando,
    // sean reales o simulados por el Modo Demo
    document.getElementById("logo-icono")
        .classList.toggle("sin-datos", !(conectado || enDemo));

    // Píldora del emisor/receptor en el hero
    const hero = document.getElementById("hero-receptor");
    if (enDemo) {
        hero.className = "linea en-demo";
        hero.innerHTML = '<i class="punto punto-demo"></i> Modo demo';
    } else {
        hero.className = "linea" + (conectado ? "" : " sin-linea");
        hero.innerHTML = '<i class="punto ' + (conectado ? "punto-on" : "punto-off") +
                         '"></i> ' + (conectado ? "En línea" : "Sin USB");
    }

    // Aviso de demostración
    document.getElementById("aviso-demo").hidden = !modoDemo;
}

function pintarKpis() {
    const validos = mensajes.filter(m => m.estado === "VALIDO");
    const rechazados = mensajes.filter(m => m.estado === "RECHAZADO");

    // Temperatura actual y variación frente al registro anterior
    const temps = mensajes.filter(
        m => m.tipo_alerta === "TEMP" && m.estado === "VALIDO");
    const ultima = temps[temps.length - 1];
    const subTemp = document.getElementById("kpi-temp-sub");

    if (ultima) {
        animarNumero(document.getElementById("kpi-temp"), Number(ultima.valor), " °C");

        if (temperaturaAnterior !== null) {
            const delta = Number(ultima.valor) - temperaturaAnterior;
            subTemp.className = "kpi-sub " + (delta > 0 ? "sube" : delta < 0 ? "baja" : "igual");
            subTemp.textContent = delta === 0
                ? "Sin cambio vs. registro anterior"
                : (delta > 0 ? "↗ +" : "↘ ") + delta + " °C vs. registro anterior";
        } else {
            subTemp.className = "kpi-sub";
            subTemp.textContent = "Último registro recibido";
        }
        temperaturaAnterior = Number(ultima.valor);
    } else {
        document.getElementById("kpi-temp").textContent = "-- °C";
        subTemp.className = "kpi-sub";
        subTemp.textContent = "Esperando registros…";
        temperaturaAnterior = null;
    }

    // Última alerta
    const ultimaAlerta = alertas[alertas.length - 1];
    const kpiAlerta = document.getElementById("kpi-alerta");
    const kpiAlertaSub = document.getElementById("kpi-alerta-sub");
    if (ultimaAlerta) {
        kpiAlerta.textContent = ultimaAlerta.tipo_alerta;
        kpiAlertaSub.innerHTML =
            '<span data-ts="' + parseFecha(ultimaAlerta.fecha_hora) + '">…</span>';
    } else {
        kpiAlerta.textContent = "--";
        kpiAlertaSub.textContent = "Sin alertas";
    }

    // Contadores animados
    animarNumero(document.getElementById("kpi-validos"), validos.length);
    animarNumero(document.getElementById("kpi-rechazados"), rechazados.length);
}

function pintarAlertasVivas() {
    const contenedor = document.getElementById("lista-alertas-live");
    const vacio = document.getElementById("live-vacio");
    const ultimas = alertas.slice(-6).reverse();

    const maxId = ultimas.length ? ultimas[0].id : ultimoIdAlertaVista;
    const html = ultimas.map(a =>
        filaAlerta(a, !primeraCarga && a.id > ultimoIdAlertaVista)).join("");

    if (pintarSiCambio(contenedor, html)) {
        ultimoIdAlertaVista = Math.max(ultimoIdAlertaVista, maxId);
        primeraCarga = false;
    }
    vacio.hidden = ultimas.length > 0;
}

function pintarTablaDashboard() {
    const cuerpo = document.querySelector("#tabla-dashboard tbody");
    const ultimos = mensajes.slice(-5).reverse();

    const html = ultimos.map((m, i) => `
        <tr>
            <td>${numero(i + 1)}</td>
            <td>${m.fecha_hora}</td>
            <td class="fuerte">${m.id_emisor}</td>
            <td>${chipTipo(m.tipo_alerta)}</td>
            <td class="fuerte">${m.valor}${m.tipo_alerta === "TEMP" ? " °C" : ""}</td>
            <td>${etiquetaEstado(m.estado)}</td>
        </tr>`).join("");

    pintarSiCambio(cuerpo, html ||
        '<tr><td colspan="6" style="text-align:center;color:#94a3b8">Sin mensajes registrados.</td></tr>');
}

function pintarMiniDispositivos() {
    const contenedor = document.getElementById("dispositivos-mini");
    const conectado = estado.usb_conectado;

    // Datos del emisor: último valor y última señal (mensajes de USR_01)
    const mensajesEmisor = mensajes.filter(m => m.id_emisor === "USR_01");
    const ultimoEmisor = mensajesEmisor[mensajesEmisor.length - 1];
    const tempValida = mensajes.filter(
        m => m.tipo_alerta === "TEMP" && m.estado === "VALIDO").pop();

    // Datos del receptor: último resultado y último mensaje
    const ultimo = mensajes[mensajes.length - 1];
    const tsUltimo = ultimo ? parseFecha(ultimo.fecha_hora) : 0;

    const html = `
        <article class="mini-dispositivo">
            <div class="mini-top">
                <img src="/static/img/microbit-emisor.png" alt="Micro:bit emisor">
                <div>
                    <h4>USR_01</h4>
                    <p>Micro:bit Emisor</p>
                </div>
                <span class="pill neutral">Radio</span>
            </div>
            <div class="mini-stats">
                <div>
                    <span>Último valor</span>
                    <strong>${tempValida ? tempValida.valor + " °C" : "--"}</strong>
                </div>
                <div>
                    <span>Última señal</span>
                    <strong ${ultimoEmisor ? `data-ts="${parseFecha(ultimoEmisor.fecha_hora)}"` : ""}>
                        ${ultimoEmisor ? "…" : "Sin datos"}
                    </strong>
                </div>
            </div>
        </article>

        <article class="mini-dispositivo">
            <div class="mini-top">
                <img src="/static/img/microbit-receptor.png" alt="Micro:bit receptor">
                <div>
                    <h4>Receptor</h4>
                    <p>Micro:bit Receptor</p>
                </div>
                <span class="pill ${conectado ? "" : "sin-conexion"}">
                    <i class="punto ${conectado ? "punto-on" : "punto-off"}"></i>
                    ${conectado ? "En línea" : "Sin USB"}
                </span>
            </div>
            <div class="mini-stats">
                <div>
                    <span>Último resultado</span>
                    <strong class="${ultimo ? (ultimo.estado === "VALIDO" ? "ok" : "malo") : ""}">
                        ${ultimo ? (ultimo.estado === "VALIDO" ? "Válido" : "Rechazado") : "Sin datos"}
                    </strong>
                </div>
                <div>
                    <span>Último mensaje</span>
                    <strong ${ultimo ? `data-ts="${tsUltimo}"` : ""}>${ultimo ? "…" : "Sin datos"}</strong>
                </div>
            </div>
        </article>`;

    pintarSiCambio(contenedor, html);
}

function pintarModuloAlertas() {
    const contenedor = document.getElementById("grid-alertas");
    const vacio = document.getElementById("alertas-vacio");

    let lista = alertas.slice().reverse();
    if (filtroAlertas !== "todas") {
        lista = lista.filter(a => a.estado === filtroAlertas);
    }

    const html = lista.map((a, i) =>
        filaAlerta(a, !primeraCarga && a.id > ultimoIdAlertaVista, true)
            .replace('class="alerta-fila',
                     'style="animation-delay:' + Math.min(i * 35, 350) + 'ms" class="alerta-fila')
    ).join("");

    pintarSiCambio(contenedor, html);
    vacio.hidden = lista.length > 0;
}

function pintarModuloHistorial() {
    const cuerpo = document.querySelector("#tabla-historial tbody");
    const vacio = document.getElementById("historial-vacio");

    let lista = mensajes.slice().reverse();
    if (filtroHistorial !== "TODOS") {
        lista = lista.filter(m => m.estado === filtroHistorial);
    }

    const html = lista.map((m, i) => `
        <tr style="animation-delay:${Math.min(i * 25, 400)}ms">
            <td>${numero(i + 1)}</td>
            <td>${m.fecha_hora}</td>
            <td class="fuerte">${m.id_emisor}</td>
            <td>${chipTipo(m.tipo_alerta)}</td>
            <td class="fuerte">${m.valor}${m.tipo_alerta === "TEMP" ? " °C" : ""}</td>
            <td>${etiquetaEstado(m.estado)}</td>
        </tr>`).join("");

    pintarSiCambio(cuerpo, html);
    vacio.hidden = lista.length > 0;
}

function pintarModuloDispositivos() {
    const conectado = estado.usb_conectado;
    const puerto = estado.puerto;

    // Emisor
    const tempValida = mensajes.filter(
        m => m.tipo_alerta === "TEMP" && m.estado === "VALIDO").pop();
    const ultimoEmisor = mensajes.filter(m => m.id_emisor === "USR_01").pop();

    document.getElementById("disp-emisor-valor").textContent =
        tempValida ? tempValida.valor + " °C" : "--";

    const senal = document.getElementById("disp-emisor-senal");
    if (ultimoEmisor) {
        senal.dataset.ts = parseFecha(ultimoEmisor.fecha_hora);
        senal.textContent = "…";
    } else {
        delete senal.dataset.ts;
        senal.textContent = "Sin datos";
    }

    // Receptor
    const pill = document.getElementById("disp-pill");
    pill.className = "pill" + (conectado ? "" : " sin-conexion");
    pill.innerHTML = '<i class="punto ' + (conectado ? "punto-on" : "punto-off") +
                     '"></i> ' + (conectado ? "En línea" : "Sin USB");

    document.getElementById("disp-usb").textContent =
        conectado ? "Conectada" + (puerto ? " · " + puerto : "") : "Sin conexión";

    const ultimo = mensajes[mensajes.length - 1];
    const ultimoEl = document.getElementById("disp-ultimo");
    if (ultimo) {
        ultimoEl.textContent = "…";
        ultimoEl.dataset.ts = parseFecha(ultimo.fecha_hora);
    } else {
        ultimoEl.textContent = "Sin datos";
        delete ultimoEl.dataset.ts;
    }

    const resultado = document.getElementById("disp-resultado");
    resultado.textContent = ultimo
        ? (ultimo.estado === "VALIDO" ? "Válido" : "Rechazado") : "Sin datos";
    resultado.className = ultimo
        ? (ultimo.estado === "VALIDO" ? "ok" : "malo") : "";

    document.getElementById("disp-total").textContent = mensajes.length;

    const barra = document.getElementById("disp-barra");
    barra.classList.toggle("ok", conectado);
    barra.querySelector(".punto").className =
        "punto " + (conectado ? "punto-on" : "punto-off");
    document.getElementById("disp-barra-texto").textContent =
        conectado ? "Receptor listo para recibir datos" : "Receptor no detectado por USB";
}

// Pinta todos los módulos en cada ciclo de actualización
function pintarTodo() {
    pintarConexion();
    // Si ya hay un escaneo, se refresca con el estado de conexión real
    if (listaSerial) pintarDispositivosSerial(listaSerial);
    pintarKpis();
    pintarAlertasVivas();
    pintarTablaDashboard();
    pintarMiniDispositivos();
    pintarModuloAlertas();
    pintarModuloHistorial();
    pintarModuloDispositivos();
    pintarGraficas();
    actualizarRelojes();
}

/* ---------------------------------------------------------
   10. FILTROS
--------------------------------------------------------- */

function configurarFiltros() {
    document.querySelectorAll("[data-filtro-alertas]").forEach(boton => {
        boton.addEventListener("click", () => {
            document.querySelectorAll("[data-filtro-alertas]")
                .forEach(b => b.classList.remove("activo"));
            boton.classList.add("activo");
            filtroAlertas = boton.dataset.filtroAlertas;
            pintarModuloAlertas();
        });
    });

    document.querySelectorAll("[data-filtro-historial]").forEach(boton => {
        boton.addEventListener("click", () => {
            document.querySelectorAll("[data-filtro-historial]")
                .forEach(b => b.classList.remove("activo"));
            boton.classList.add("activo");
            filtroHistorial = boton.dataset.filtroHistorial;
            pintarModuloHistorial();
        });
    });
}

/* ---------------------------------------------------------
   11. BUSCAR RECEPTOR (escaneo de puertos COM)
--------------------------------------------------------- */

let escaneando = false; // evita escaneos simultáneos
let listaSerial = null;  // último escaneo, para refrescar con el estado real

// Pinta un ítem de la lista de dispositivos seriales
function filaSerial(d) {
    const icono = d.tipo === "microbit" ? "" : d.tipo === "arduino" ? " ar" : "";
    const svg = d.tipo === "microbit" ? "#i-cpu" : d.tipo === "arduino" ? "#i-plug" : "#i-monitor";

    let badge;
    if (d.tipo === "microbit") {
        badge = '<span class="badge-tipo ok">Micro:bit</span>';
    } else if (d.tipo === "arduino") {
        badge = '<span class="badge-tipo ar">Arduino</span>';
    } else {
        badge = '<span class="badge-tipo neutral">Otro</span>';
    }

    // Estado REAL: solo se muestra "Conectado" si el sistema realmente
    // abrió ese puerto (nunca se muestra una conexión que no existe)
    const enUso = estado.usb_conectado && estado.puerto === d.puerto;
    const elegido = !!d.seleccionado;

    let boton;
    if (enUso) {
        boton = '<button class="btn-conectar activo js-desconectar"' +
                ' title="Puerto abierto y leyendo. Pulsa para volver al automático.">' +
                'Conectado</button>';
    } else if (elegido) {
        // Elegido pero aún sin conexión: se muestra el intento y su motivo
        const motivo = estado.error_puerto || "Puerto elegido: intentando abrir…";
        boton = '<button class="btn-conectar pendiente js-desconectar"' +
                ' title="' + motivo + ' Pulsa para volver al automático.">' +
                (estado.error_puerto ? "No conecta" : "Intentando…") +
                '</button>';
    } else {
        boton = '<button class="btn-conectar js-conectar" data-puerto="' + d.puerto + '"' +
                ' title="Usar este puerto como receptor USB">Conectar</button>';
    }

    const sub = [
        d.puerto,
        d.fabricante || "",
        d.vid ? "VID " + d.vid : "",
        d.compatible ? "Compatible" : "No compatible"
    ].filter(Boolean).join(" · ");

    return `
        <div class="fila-serial${enUso ? " en-uso" : ""}">
            <div class="fila-serial-icono${icono}"><svg><use href="${svg}"/></svg></div>
            <div class="fila-serial-info">
                <strong>${d.nombre}</strong>
                <span>${sub}</span>
            </div>
            ${badge}
            ${boton}
        </div>`;
}

// Consulta el backend y pinta la lista de dispositivos encontrados
async function buscarReceptores() {
    if (escaneando) return; // ya hay un escaneo en curso
    escaneando = true;

    // Activar estado de carga en los dos botones
    document.querySelectorAll(".btn-buscar").forEach(b => {
        b.classList.add("buscando");
        b.disabled = true;
    });
    const contenedor = document.getElementById("lista-serial");
    contenedor.innerHTML = '<p class="vacio">Escaneando puertos COM…</p>';
    delete contenedor.dataset.hash; // se olvida el HTML anterior para forzar el repintado

    try {
        const respuesta = await fetch(API.dispositivosSerial);
        if (!respuesta.ok) throw new Error("Error en el escaneo");
        const dispositivos = await respuesta.json();
        pintarDispositivosSerial(dispositivos);
    } catch (error) {
        document.getElementById("lista-serial").innerHTML =
            '<p class="vacio">No se pudo completar el escaneo. ¿Está el backend activo?</p>';
    }

    // Quitar estado de carga
    document.querySelectorAll(".btn-buscar").forEach(b => {
        b.classList.remove("buscando");
        b.disabled = false;
    });
    escaneando = false;
}

// Pinta la lista de dispositivos encontrados
function pintarDispositivosSerial(dispositivos) {
    const contenedor = document.getElementById("lista-serial");
    listaSerial = dispositivos; // se guarda para refrescar el estado real

    if (!dispositivos || dispositivos.length === 0) {
        contenedor.innerHTML =
            '<p class="vacio">No se detectaron puertos COM. Conecta el micro:bit receptor por USB y vuelve a escanear.</p>';
        return;
    }

    // Se pone el micro:bit primero, luego Arduino, luego el resto
    const orden = { microbit: 0, arduino: 1, otro: 2 };
    dispositivos.sort((a, b) => (orden[a.tipo] ?? 3) - (orden[b.tipo] ?? 3));

    const html = dispositivos.map((d, i) =>
        filaSerial(d).replace('class="fila-serial',
            'style="animation-delay:' + Math.min(i * 45, 350) + 'ms" class="fila-serial')
    ).join("");

    pintarSiCambio(contenedor, html);
}

// Conecta (o desconecta) el puerto elegido por el usuario
async function conectarPuerto(puerto) {
    try {
        const respuesta = await fetch(API.conectar, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ puerto: puerto || null })
        });
        if (!respuesta.ok) throw new Error("Error al conectar");
        await respuesta.json();
        buscarReceptores(); // refrescar la lista para reflejar el cambio
    } catch (error) {
        console.error("Error al cambiar de puerto:", error);
    }
}

function configurarBusqueda() {
    // Botón en la barra superior
    const btnTop = document.getElementById("btn-buscar-top");
    if (btnTop) {
        btnTop.addEventListener("click", () => {
            // Al buscar desde la barra superior, se abre el módulo de Dispositivos
            irAModulo("dispositivos");
            buscarReceptores();
        });
    }

    // Botón dentro del módulo de Dispositivos
    const btnDisp = document.getElementById("btn-buscar-disp");
    if (btnDisp) {
        btnDisp.addEventListener("click", buscarReceptores);
    }

    // Delegación de eventos para los botones "Conectar" / "Desconectar"
    document.getElementById("lista-serial").addEventListener("click", e => {
        const conectar = e.target.closest(".js-conectar");
        const desconectar = e.target.closest(".js-desconectar");
        if (conectar) {
            conectarPuerto(conectar.dataset.puerto);
        } else if (desconectar) {
            conectarPuerto(null); // vuelve al modo automático
        }
    });
}

/* ---------------------------------------------------------
   11b. MODO DEMO (activación manual con popup)
   El usuario puede forzar datos simulados aunque exista
   hardware real. Siempre se avisa antes de entrar.
--------------------------------------------------------- */

let tipoModalDemo = "entrar"; // qué acción confirmará el popup

// Contenido del popup según la acción que se va a confirmar
const TEXTOS_DEMO = {
    entrar: {
        titulo: "Entrar al Modo Demo",
        texto: "Al entrar al Modo Demo, los datos que se muestran serán " +
               "genéricos y simulativos: la interfaz generará por su cuenta " +
               "mensajes, alertas y temperaturas de ejemplo.",
        puntos: [
            "Los valores NO provienen del Micro:bit ni de la base de datos.",
            "Se mostrará el aviso «DATOS DE DEMOSTRACIÓN» en la barra superior.",
            "Si hay un receptor conectado, sus datos reales dejarán de verse hasta que salgas del modo.",
            "Puedes salir en cualquier momento volviendo a pulsar MODO DEMO."
        ],
        accion: "Activar Modo Demo"
    },
    salir: {
        titulo: "Salir del Modo Demo",
        texto: "Se dejarán de mostrar los datos simulados y la interfaz volverá " +
               "a mostrar la información real que llegue del receptor USB " +
               "(si el backend está activo).",
        puntos: [
            "Los datos ficticios no están guardados en la base de datos.",
            "Si no hay hardware conectado, no se mostrarán registros hasta que lleguen datos reales."
        ],
        accion: "Salir del Modo Demo"
    }
};

// Abre el popup con los textos de la acción elegida
function abrirModalDemo(tipo) {
    tipoModalDemo = tipo;
    const t = TEXTOS_DEMO[tipo];
    document.getElementById("modal-demo-titulo").textContent = t.titulo;
    document.getElementById("modal-demo-texto").textContent = t.texto;
    document.getElementById("modal-demo-lista").innerHTML =
        t.puntos.map(p => "<li>" + p + "</li>").join("");
    document.getElementById("modal-demo-aceptar").textContent = t.accion;
    document.getElementById("modal-demo").hidden = false;
    document.getElementById("modal-demo-aceptar").focus();
}

function cerrarModalDemo() {
    document.getElementById("modal-demo").hidden = true;
}

// Enciende o apaga el Modo Demo a petición del usuario
function aplicarModoDemo(activar) {
    demoManual = activar;
    document.getElementById("btn-modo-demo").classList.toggle("activo", activar);

    // Se rehace la serie de datos: nueva al entrar, vacía al salir
    mensajesDemo = [];
    if (activar) iniciarDemo();

    actualizarDatos(); // pinta de inmediato con el modo nuevo
}

function configurarModoDemo() {
    // El botón abre el popup: para entrar o para salir, según corresponda
    document.getElementById("btn-modo-demo").addEventListener("click", () => {
        abrirModalDemo(demoManual ? "salir" : "entrar");
    });

    document.getElementById("modal-demo-aceptar").addEventListener("click", () => {
        cerrarModalDemo();
        aplicarModoDemo(tipoModalDemo === "entrar");
    });

    document.getElementById("modal-demo-cancelar").addEventListener("click", cerrarModalDemo);

    // Cierre haciendo clic fuera de la caja
    document.getElementById("modal-demo").addEventListener("click", e => {
        if (e.target.id === "modal-demo") cerrarModalDemo();
    });

    // Cierre con la tecla Escape
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") cerrarModalDemo();
    });
}

/* ---------------------------------------------------------
   12. INICIO DE LA APLICACIÓN
--------------------------------------------------------- */

function iniciar() {
    iniciarDemo();              // datos mientras no hay backend
    configurarNavegacion();
    configurarFiltros();
    configurarRangos();
    configurarBusqueda();
    configurarModoDemo();
    crearGraficas();
    pintarTodo();

    // Reloj y tiempos relativos: cada segundo
    actualizarRelojes();
    setInterval(actualizarRelojes, 1000);

    // Consulta periódica al backend (sin recargar la página)
    actualizarDatos();
    setInterval(actualizarDatos, INTERVALO_ACTUALIZACION);
}

document.addEventListener("DOMContentLoaded", iniciar);
