# =========================================================
# MicroLink - Preparación para GitHub Pages
#
# Genera la carpeta docs/ con la versión estática de la
# interfaz (sin Flask ni Jinja) para publicarla en Pages.
#
# Uso:   python preparar_pages.py
#
# Nota: la versión de GitHub Pages NO tiene backend, así que
# la interfaz entrará en modo demostración automáticamente y
# mostrará el aviso "DATOS DE DEMOSTRACIÓN". Los datos reales
# siguen funcionando en local con:  python app.py
# =========================================================

import re
import shutil
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
PLANTILLA = RAIZ / "templates" / "index.html"
SALIDA = RAIZ / "docs"

# {{ url_for('static', filename='css/style.css') }} -> static/css/style.css
# (ruta relativa: funciona en Flask y también en GitHub Pages,
#  aunque el sitio quede dentro de una carpeta como /MicroLink/)
EXPRESION = re.compile(
    r"\{\{\s*url_for\(\s*'static'\s*,\s*filename='([^']+)'\s*\)\s*\}\}")


def convertir_plantilla():
    """Devuelve el HTML con las rutas de Flask convertidas a rutas simples."""
    html = PLANTILLA.read_text(encoding="utf-8")
    html_convertido, total = EXPRESION.subn(r"static/\1", html)
    return html_convertido, total


def main():
    SALIDA.mkdir(exist_ok=True)

    # 1. index.html convertido (sin expresiones Jinja)
    html, total = convertir_plantilla()
    if "{{" in html or "{%" in html:
        print("Aviso: quedaron expresiones Jinja en el HTML.")
    (SALIDA / "index.html").write_text(html, encoding="utf-8")

    # 2. Copia completa de static/ (css, js, img) — se reemplaza la anterior
    destino_static = SALIDA / "static"
    if destino_static.exists():
        shutil.rmtree(destino_static)
    shutil.copytree(RAIZ / "static", destino_static)

    # 3. .nojekyll para que GitHub Pages publique los archivos tal cual
    (SALIDA / ".nojekyll").write_text("", encoding="utf-8")

    print("Carpeta docs/ lista para GitHub Pages")
    print(" - index.html convertido (%d rutas arregladas)" % total)
    print(" - static/ copiado (css, js, img)")
    print("")
    print("Siguientes pasos:")
    print(" 1. Sube el proyecto a GitHub (repositorio PUBLICO)")
    print(" 2. En el repo: Settings > Pages > Source: Deploy from a branch")
    print("    Branch: main  |  Folder: /docs  >  Save")
    print(" 3. En unos minutos abre:  https://TU-USUARIO.github.io/NOMBRE-REPO/")


if __name__ == "__main__":
    main()
