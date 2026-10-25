"""Recorta y reduce el hillshade del distrito al bbox de la SRL Unidad Conchos para el plano del informe NDVI.

Entrada : public/dem-distrito-hillshade/hillshade_noche_315_45.jpg (1370x2632, bbox en manifest.json)
Salida  : public/dem-distrito-hillshade/hillshade_srl_plano.jpg + hillshade_srl_plano.json (procedencia y bbox exacto)
Uso     : python scripts/recorta_hillshade_srl.py [ancho_px=560] [calidad=60]
Reproducible: mismas entradas -> mismo JPEG. Escala de grises aclarada (los módulos van encima al 85 % de opacidad y
las etiquetas necesitan fondo claro); el relieve queda como textura, no como dato.
"""
import json, sys, math, os
from PIL import Image, ImageOps

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DIR = os.path.join(RAIZ, 'public', 'dem-distrito-hillshade')
ANCHO = int(sys.argv[1]) if len(sys.argv) > 1 else 560
CALIDAD = int(sys.argv[2]) if len(sys.argv) > 2 else 60
MARGEN = 0.10      # fracción del lado, en cada borde, alrededor de la caja de los 6 módulos SRL
ACLARADO = 0.40    # 0 = blanco, 1 = sin cambio: out = 255 - (255 - v) * ACLARADO (tras estirar el contraste)
ESTIRADO = 1       # % de píxeles recortados en cada extremo al estirar el histograma (el llano domina la imagen)

man = json.load(open(os.path.join(DIR, 'manifest.json'), encoding='utf-8'))
w0, s0, e0, n0 = man['bbox']
# Caja de los 6 módulos SRL (calculada de public/geo/modulos.geojson, numero_modulo 1,2,4,5,6,9)
fc = json.load(open(os.path.join(RAIZ, 'public', 'geo', 'modulos.geojson'), encoding='utf-8'))
SRL = {1, 4, 2, 6, 5, 9}
xs, ys = [], []
for f in fc['features']:
    if f['properties'].get('numero_modulo') not in SRL: continue
    g = f['geometry']
    for poly in ([g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']):
        for x, y in poly[0]: xs.append(x); ys.append(y)
minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
mx, my = (maxx - minx) * MARGEN, (maxy - miny) * MARGEN
bw, be, bs, bn = max(w0, minx - mx), min(e0, maxx + mx), max(s0, miny - my), min(n0, maxy + my)

im = Image.open(os.path.join(DIR, 'hillshade_noche_315_45.jpg')).convert('L')
W, H = im.size
px = lambda lon: (lon - w0) / (e0 - w0) * W
py = lambda lat: (n0 - lat) / (n0 - s0) * H
caja = (round(px(bw)), round(py(bn)), round(px(be)), round(py(bs)))
# bbox REAL tras redondear a pixel (el SVG usa este, no el pedido)
rw = w0 + caja[0] / W * (e0 - w0); re_ = w0 + caja[2] / W * (e0 - w0)
rn = n0 - caja[1] / H * (n0 - s0); rs = n0 - caja[3] / H * (n0 - s0)
rec = im.crop(caja)
alto = round(ANCHO * rec.size[1] / rec.size[0])
rec = rec.resize((ANCHO, alto), Image.LANCZOS)
rec = ImageOps.autocontrast(rec, cutoff=ESTIRADO)
rec = rec.point(lambda v: round(255 - (255 - v) * ACLARADO))
ruta = os.path.join(DIR, 'hillshade_srl_plano.jpg')
rec.save(ruta, 'JPEG', quality=CALIDAD, optimize=True, progressive=False)
meta = {
    'archivo': 'hillshade_srl_plano.jpg', 'ancho': ANCHO, 'alto': alto, 'bytes': os.path.getsize(ruta),
    'bbox': [round(rw, 6), round(rs, 6), round(re_, 6), round(rn, 6)],
    'bboxFormato': '[minLon, minLat, maxLon, maxLat] CRS84', 'origen': 'hillshade_noche_315_45.jpg (ver manifest.json)',
    'fuenteDEM': man.get('fuenteDEM'), 'fuenteTextura': man.get('fuenteTextura'),
    'transformacion': f'recorte a la caja de los 6 módulos SRL + {int(MARGEN*100)} % de margen, reducción LANCZOS a {ANCHO} px, contraste estirado ({ESTIRADO} %), aclarado x{ACLARADO}, JPEG q{CALIDAD} escala de grises',
    'script': 'scripts/recorta_hillshade_srl.py', 'generadoEn': man.get('generadoEn'),
}
json.dump(meta, open(os.path.join(DIR, 'hillshade_srl_plano.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(meta['ancho'], 'x', meta['alto'], meta['bytes'], 'bytes', meta['bbox'])
