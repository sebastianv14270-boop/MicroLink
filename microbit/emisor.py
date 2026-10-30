# =========================================================
# MicroLink - Micro:bit EMISOR
# Envía la temperatura por radiofrecuencia cada 2 segundos.
#
# Formato del mensaje:
#   ID_EMISOR:TIPO_ALERTA:VALOR:PSK
# Ejemplo:
#   USR_01:TEMP:26:SEC123
# =========================================================

from microbit import sleep, display, temperature
import radio

# Configuración del emisor
ID_EMISOR = "USR_01"     # identificador del dispositivo
PSK = "SEC123"           # clave compartida con el receptor
GRUPO = 23               # canal de radio (0-255)

# Se activa la radio con el mismo canal que el receptor
radio.on()
radio.config(group=GRUPO)

display.show("E")  # "E" de emisor

while True:
    # Se lee el sensor de temperatura de la micro:bit
    valor = temperature()

    # Se arma el mensaje con sus cuatro componentes
    mensaje = ID_EMISOR + ":TEMP:" + str(valor) + ":" + PSK

    # Se envía por radio
    radio.send(mensaje)

    # Se muestra el valor enviado en la matriz LED
    display.scroll(str(valor), delay=80)

    sleep(2000)  # espera de 2 segundos antes del siguiente envío
