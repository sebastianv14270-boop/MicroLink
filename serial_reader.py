# =========================================================
# MicroLink - Lectura del puerto serial (USB)
# Recibe los mensajes que envía el Micro:bit receptor y los
# guarda en la base de datos.
# Se ejecuta en un hilo aparte para que Flask siga atendiendo
# las peticiones web sin bloquearse.
#
# Además puede escanear los puertos COM del computador para
# encontrar el receptor (botón "Buscar receptor").
# =========================================================

import os
import threading
import time

import serial
from serial.tools import list_ports

import database

# Estado de la conexión, consultado por la ruta /api/estado
# error: motivo por el que el puerto elegido no pudo abrirse (None = sin error)
_estado = {"conectado": False, "puerto": None, "error": None}

# Puerto elegido manualmente desde la interfaz (None = automático)
_puerto_forzado = None
_candado = threading.Lock()

# Identificación de los dispositivos
VID_MICROBIT = 0x0D28                     # ARM / DAPLink (micro:bit)
VID_ARDUINO = {0x2341, 0x2A03}            # Arduino oficial
VID_CLONES = {0x1A86, 0x10C4, 0x0403}     # CH340, CP210x, FTDI (clones Arduino)
PALABRAS_ARDUINO = ("arduino", "ch340", "ch910", "cp210",
                    "usb serial", "usb-serial", "ftdi")


# ---------------------------------------------------------
# Búsqueda y escaneo de dispositivos
# ---------------------------------------------------------
def definir_puerto(puerto):
    """Fija el puerto que se debe usar (None = vuelta a automático)."""
    global _puerto_forzado
    with _candado:
        _puerto_forzado = puerto or None
    _estado["error"] = None  # al cambiar de puerto se limpia el intento anterior


def puerto_forzado():
    with _candado:
        return _puerto_forzado


def buscar_puerto():
    """Devuelve el puerto COM que debe usar el receptor."""
    with _candado:
        forzado = _puerto_forzado
    if forzado:
        return forzado  # decisión del usuario

    # Modo automático: busca el Micro:bit por su chip (VID) o descripción
    for puerto in list_ports.comports():
        descripcion = ((puerto.description or "") + " " +
                       (puerto.manufacturer or "")).lower()
        if (puerto.vid == VID_MICROBIT or "microbit" in descripcion or
                "daplink" in descripcion or "mbed" in descripcion):
            return puerto.device
    return None


def clasificar(puerto):
    """Clasifica un puerto COM según el tipo de dispositivo."""
    descripcion = ((puerto.description or "") + " " +
                   (puerto.manufacturer or "")).lower()
    vid = puerto.vid

    if vid == VID_MICROBIT or any(p in descripcion for p in
                                  ("microbit", "daplink", "mbed")):
        return "microbit", "Micro:bit", True
    if vid in VID_ARDUINO or vid in VID_CLONES or \
            any(p in descripcion for p in PALABRAS_ARDUINO):
        return "arduino", "Arduino / clon", False
    return "otro", "Otro dispositivo", False


def escanear_puertos():
    """Lista todos los puertos COM con su tipo y si son compatibles.

    Nota: esto detecta lo que está conectado por USB. El enlace de
    2.4 GHz entre los dos micro:bits no puede verse desde el
    computador.
    """
    with _candado:
        actual = _puerto_forzado

    dispositivos = []
    for p in list_ports.comports():
        tipo, etiqueta, compatible = clasificar(p)
        dispositivos.append({
            "puerto": p.device,
            "nombre": (p.description or "Dispositivo serial").strip(),
            "fabricante": (p.manufacturer or "").strip(),
            "vid": ("0x%04X" % p.vid) if p.vid else None,
            "pid": ("0x%04X" % p.pid) if p.pid else None,
            "tipo": tipo,
            "etiqueta": etiqueta,
            "compatible": compatible,
            "seleccionado": p.device == actual,
        })
    return dispositivos


# ---------------------------------------------------------
# Lectura de mensajes
# ---------------------------------------------------------
def procesar_linea(linea):
    """Procesa una línea enviada por el receptor.

    Formato esperado:  ESTADO|ID_EMISOR:TIPO:VALOR:CLAVE
    Ejemplo:           VALIDO|USR_01:TEMP:26:SEC123
    """
    linea = linea.strip()
    if not linea or "|" not in linea:
        return  # se ignoran líneas basura o del arranque de la placa

    estado, contenido = linea.split("|", 1)
    estado = estado.strip().upper()
    if estado not in ("VALIDO", "RECHAZADO"):
        estado = "RECHAZADO"

    partes = contenido.split(":")
    if len(partes) == 4:
        id_emisor, tipo_alerta, valor, clave = partes
    else:
        # Mensaje con estructura incorrecta: se registra igualmente
        id_emisor, tipo_alerta, valor, clave = "DESCONOCIDO", "INVALIDO", contenido[:30], ""

    database.guardar_mensaje(id_emisor, tipo_alerta, valor, clave, estado)


def _leer_puerto():
    """Conecta al receptor y lee sus mensajes hasta que se desconecte."""
    puerto = buscar_puerto()
    if not puerto:
        return False

    try:
        conexion = serial.Serial(puerto, 115200, timeout=1)
    except (serial.SerialException, OSError) as error:
        # Se anota el motivo real para que la interfaz no muestre "Conectado"
        _estado["error"] = "No se pudo abrir %s (%s)" % (puerto, str(error)[:60])
        return False

    with conexion:
        _estado["conectado"] = True
        _estado["puerto"] = puerto
        _estado["error"] = None
        time.sleep(2)  # la placa se reinicia al abrir el puerto

        while True:
            # Si el usuario eligió otro puerto, se cambia de conexión
            if buscar_puerto() != puerto:
                break

            datos = conexion.readline()
            if not datos:
                continue
            try:
                linea = datos.decode("utf-8", errors="ignore")
            except Exception:
                continue
            try:
                procesar_linea(linea)
            except Exception as error:
                print("Error al guardar el mensaje:", error)


def _hilo_principal():
    """Hilo que mantiene viva la conexión serial."""
    while True:
        try:
            conectado = _leer_puerto()
        except (serial.SerialException, OSError):
            conectado = False

        if not conectado:
            _estado["conectado"] = False
            _estado["puerto"] = None
            time.sleep(3)  # vuelve a intentar en 3 segundos


def iniciar():
    """Inicia la lectura serial en un hilo independiente."""
    hilo = threading.Thread(target=_hilo_principal, daemon=True)
    hilo.start()


def obtener_estado():
    """Devuelve el estado actual de la conexión USB."""
    return dict(_estado)
