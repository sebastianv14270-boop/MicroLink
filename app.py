# =========================================================
# MicroLink - Aplicación principal (Flask)
# Rutas de consulta para la aplicación web.
#
# Arquitectura:
#   Micro:bit emisor -> Radio -> Micro:bit receptor
#        -> USB -> Python (PySerial) -> Flask -> Página web
# =========================================================

from flask import Flask, render_template, request, jsonify

import database
import serial_reader

app = Flask(__name__)


# ---------------------------------------------------------
# Página principal
# ---------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------
# Estado general del sistema
# ---------------------------------------------------------
@app.route("/api/estado")
def api_estado():
    serial_estado = serial_reader.obtener_estado()
    return jsonify({
        "usb_conectado": serial_estado["conectado"],
        "puerto": serial_estado["puerto"],
        "error_puerto": serial_estado.get("error"),
        "mensajes_validos": database.contar("VALIDO"),
        "mensajes_rechazados": database.contar("RECHAZADO"),
        "temperatura_actual": database.temperatura_actual(),
    })


# ---------------------------------------------------------
# Últimos mensajes recibidos (válidos y rechazados)
# ---------------------------------------------------------
@app.route("/api/mensajes")
def api_mensajes():
    return jsonify(database.obtener_mensajes(limite=100))


# ---------------------------------------------------------
# Alertas recibidas
# ---------------------------------------------------------
@app.route("/api/alertas")
def api_alertas():
    return jsonify(database.obtener_alertas(limite=50))


# ---------------------------------------------------------
# Serie de temperaturas para las gráficas
# ---------------------------------------------------------
@app.route("/api/temperatura")
def api_temperatura():
    serie = database.obtener_temperatura(limite=60)
    return jsonify({
        "serie": serie,
        "actual": serie[-1]["valor"] if serie else None,
    })


# ---------------------------------------------------------
# Escaneo de puertos COM (botón "Buscar receptor")
# Devuelve los dispositivos conectados por USB y su tipo.
# Nota: el enlace de 2.4 GHz entre los micro:bits no es
# visible desde el computador.
# ---------------------------------------------------------
@app.route("/api/dispositivos-serial")
def api_dispositivos_serial():
    return jsonify(serial_reader.escanear_puertos())


# ---------------------------------------------------------
# Selección manual del puerto del receptor
# ---------------------------------------------------------
@app.route("/api/conectar", methods=["POST"])
def api_conectar():
    datos = request.get_json(silent=True) or {}
    puerto = datos.get("puerto")

    # Si llega vacío, se vuelve al modo automático
    serial_reader.definir_puerto(puerto)
    return jsonify({
        "ok": True,
        "puerto": puerto or None,
        "automatico": not puerto,
    })


# ---------------------------------------------------------
# Arranque
# ---------------------------------------------------------
if __name__ == "__main__":
    database.crear_tabla()          # crea la tabla si no existe
    serial_reader.iniciar()         # lectura USB en un hilo aparte
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
