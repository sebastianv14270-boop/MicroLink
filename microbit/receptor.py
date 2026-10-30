# =========================================================
# MicroLink - Micro:bit RECEPTOR
#
# 1. Recibe el mensaje por radio.
# 2. Separa sus cuatro componentes.
# 3. Comprueba que la estructura sea correcta.
# 4. Valida la clave compartida.
# 5. Muestra el resultado en la matriz LED.
# 6. Envía el resultado al computador por USB (serial).
#
# IMPORTANTE: se envían TANTO los mensajes válidos como los
# rechazados, para que la aplicación web registre los dos
# resultados. Por eso el receptor imprime una línea con la
# forma:   ESTADO|ID_EMISOR:TIPO:VALOR:CLAVE
# Ejemplo: VALIDO|USR_01:TEMP:26:SEC123
# La única adaptación respecto del código original de
# recepción es el uso de print() para enviar el resultado
# por el puerto USB hacia el computador.
# =========================================================

from microbit import sleep, display, Image
import radio

# Configuración del receptor
PSK = "SEC123"      # clave compartida con el emisor
GRUPO = 23          # canal de radio (debe ser igual al del emisor)

radio.on()
radio.config(group=GRUPO)

display.show("R")   # "R" de receptor


def estructura_correcta(partes):
    """Comprueba que el mensaje tenga sus 4 componentes."""
    return len(partes) == 4


while True:
    recibido = radio.receive()

    if recibido:
        # 2. Se separan los cuatro componentes del mensaje
        partes = recibido.split(":")

        # 3. Se comprueba la estructura y 4. la clave compartida
        if estructura_correcta(partes) and partes[3] == PSK:
            estado = "VALIDO"
            display.show(Image.YES)        # 5. palomita en la matriz LED
        else:
            estado = "RECHAZADO"
            display.show(Image.NO)         # 5. equis en la matriz LED

        # 6. Se informa al computador por el puerto USB serial
        #    (tanto los válidos como los rechazados)
        print(estado + "|" + recibido)

        sleep(1000)
        display.show("R")

    sleep(50)
