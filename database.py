# =========================================================
# MicroLink - Base de datos SQLite
# Una sola tabla: mensajes (válidos y rechazados)
# =========================================================

import os
import sqlite3
from datetime import datetime

# Ruta del archivo de base de datos (junto a app.py)
RUTA_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "microlink.db")


def conectar():
    """Crea una conexión sencilla a la base de datos."""
    conexion = sqlite3.connect(RUTA_DB)
    conexion.row_factory = sqlite3.Row  # permite leer por nombre de columna
    return conexion


def crear_tabla():
    """Crea la tabla mensajes si todavía no existe."""
    conexion = conectar()
    conexion.execute("""
        CREATE TABLE IF NOT EXISTS mensajes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_emisor TEXT NOT NULL,
            tipo_alerta TEXT NOT NULL,
            valor TEXT NOT NULL,
            clave_recibida TEXT NOT NULL,
            estado TEXT NOT NULL,
            fecha_hora TEXT NOT NULL
        )
    """)
    conexion.commit()
    conexion.close()


def guardar_mensaje(id_emisor, tipo_alerta, valor, clave_recibida, estado):
    """Guarda un mensaje nuevo (válido o rechazado)."""
    fecha_hora = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    conexion = conectar()
    conexion.execute(
        """INSERT INTO mensajes
           (id_emisor, tipo_alerta, valor, clave_recibida, estado, fecha_hora)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (id_emisor, tipo_alerta, valor, clave_recibida, estado, fecha_hora)
    )
    conexion.commit()
    conexion.close()
    return fecha_hora


def obtener_mensajes(limite=100):
    """Devuelve los últimos mensajes, del más antiguo al más reciente."""
    conexion = conectar()
    filas = conexion.execute(
        """SELECT id, id_emisor, tipo_alerta, valor, clave_recibida, estado, fecha_hora
           FROM mensajes ORDER BY id DESC LIMIT ?""",
        (limite,)
    ).fetchall()
    conexion.close()
    return [dict(f) for f in reversed(filas)]


def obtener_alertas(limite=50):
    """Devuelve las alertas recibidas (mensajes con tipo de alerta)."""
    conexion = conectar()
    filas = conexion.execute(
        """SELECT id, id_emisor, tipo_alerta, valor, clave_recibida, estado, fecha_hora
           FROM mensajes
           WHERE tipo_alerta != 'INVALIDO'
           ORDER BY id DESC LIMIT ?""",
        (limite,)
    ).fetchall()
    conexion.close()
    return [dict(f) for f in reversed(filas)]


def contar(estado):
    """Cuenta los mensajes según su estado (VALIDO o RECHAZADO)."""
    conexion = conectar()
    fila = conexion.execute(
        "SELECT COUNT(*) AS total FROM mensajes WHERE estado = ?",
        (estado,)
    ).fetchone()
    conexion.close()
    return fila["total"]


def temperatura_actual():
    """Devuelve el último valor de temperatura registrado (o None)."""
    conexion = conectar()
    fila = conexion.execute(
        """SELECT valor FROM mensajes
           WHERE tipo_alerta = 'TEMP' AND estado = 'VALIDO'
           ORDER BY id DESC LIMIT 1"""
    ).fetchone()
    conexion.close()
    return float(fila["valor"]) if fila else None


def obtener_temperatura(limite=60):
    """Devuelve la serie de temperaturas para la gráfica."""
    conexion = conectar()
    filas = conexion.execute(
        """SELECT valor, fecha_hora FROM mensajes
           WHERE tipo_alerta = 'TEMP' AND estado = 'VALIDO'
           ORDER BY id DESC LIMIT ?""",
        (limite,)
    ).fetchall()
    conexion.close()

    serie = []
    for f in reversed(filas):
        try:
            valor = float(f["valor"])
        except ValueError:
            continue  # se ignoran valores que no sean números
        serie.append({"fecha_hora": f["fecha_hora"], "valor": valor})
    return serie
