#!/usr/bin/env python3
"""Builds server/data/drinks-cm.json (the Bar & Resto drinks catalog) from docs/aahsso_beverage_catalog_cameroon.xlsx.
Standard library only. RGB (returnable glass bottle) becomes "Bottle", PET becomes "Plastic".
  python3 server/scripts/build-drinks-catalog.py            then: cd server && npm run seed:drinks
"""
import zipfile, re, sys, json, xml.etree.ElementTree as ET
N={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
def read(path):
    z=zipfile.ZipFile(path); ss=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',N):
            ss.append(''.join(t.text or '' for t in si.iter('{%s}t'%N['m'])))
    wb=ET.fromstring(z.read('xl/workbook.xml')); rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rmap={r.get('Id'):r.get('Target') for r in rels}
    out={}
    for sh in wb.find('m:sheets',N):
        t=rmap[sh.get('{%s}id'%N['r'])]; t=t.lstrip('/'); t=t if t.startswith('xl/') else 'xl/'+t
        rows=[]
        for row in ET.fromstring(z.read(t)).iter('{%s}row'%N['m']):
            r={}
            for c in row.findall('m:c',N):
                ref=c.get('r'); col=re.match(r'[A-Z]+',ref).group(); v=c.find('m:v',N); typ=c.get('t')
                if typ=='s' and v is not None: val=ss[int(v.text)]
                elif typ=='inlineStr': val=''.join(x.text or '' for x in c.iter('{%s}t'%N['m']))
                else: val=v.text if v is not None else None
                r[col]=val
            rows.append(r)
        out[sh.get('name')]=rows
    return out

import os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'docs', 'aahsso_beverage_catalog_cameroon.xlsx')
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'server', 'data', 'drinks-cm.json')
d = read(src)
PACK = {'RGB': 'Bottle', 'PET': 'Plastic'}
def fix(t):  # RGB = returnable glass bottle → Bottle, PET = plastic → Plastic
    t = str(t or '').strip()
    t = re.sub(r'\bRGB\b', 'Bottle', t); t = re.sub(r'\bPET = plastic\b', 'Plastic = plastic bottle', t); t = re.sub(r'\bPET\b', 'Plastic', t)
    return t
def num(v):
    if v in (None, ''): return None
    f = float(v); return int(f) if f == int(f) else round(f, 4)
items = []
for r in d['Catalog'][1:]:
    if not r.get('A'): continue
    g = lambda k: fix(r.get(k))
    it = {
      'sku': g('A'), 'name': g('B'), 'cat': g('C'), 'sub': g('D'), 'brand': g('E'), 'variant': g('F'),
      'ml': num(r.get('G')), 'pack': PACK.get(r.get('H'), g('H')), 'returnable': r.get('I') == 'Y', 'perCase': num(r.get('J')),
      'abv': None if r.get('K') in (None, '') else round(float(r['K']) * 100, 2),
      'country': g('L'), 'region': g('M'), 'grape': g('N'), 'sweetness': g('O'), 'producer': g('P'), 'supplier': g('Q'), 'tier': g('R'),
      'cost': num(r.get('S')), 'priceBar': num(r.get('T')), 'priceLounge': num(r.get('U')),
      'byGlass': r.get('X') == 'Y', 'pourMl': num(r.get('Y')), 'pours': num(r.get('Z')),
      'barcode': g('AA'), 'active': r.get('AB') != 'N', 'confidence': g('AC'), 'notes': g('AD'),
    }
    if it['byGlass'] and it['pours'] is None and it['ml'] and it['pourMl']: it['pours'] = round(it['ml'] / it['pourMl'], 2)
    items.append({k: v for k, v in it.items() if v not in (None, '') and not (k == 'active' and v is True) and not (k in ('returnable', 'byGlass') and v is False)})
readme = [(fix(r.get('A')), fix(r.get('B'))) for r in d['README'][2:] if r.get('A')]
lists = d['Lists']; hdr = lists[0]
col = lambda c: [PACK.get(r.get(c), fix(r.get(c))) for r in lists[1:] if r.get(c)]
PACK_DESC = {'Bottle': 'Returnable glass bottle (consigne) — track crates and deposits', 'Glass': 'One-way glass bottle', 'Can': 'Can', 'Plastic': 'Plastic bottle', 'Carton': 'Tetra Brik / juice carton', 'Served': 'Prepared to order (fresh juice, palm wine)'}
CONF = {'High': 'Brand, size and availability well established', 'Medium': 'Sold in Cameroon — check the size, strength or price', 'Verify': 'Plausible but not confirmed — check before selling'}
cats = []
for c in col('A'):
    subs = []
    for i in items:
        if i['cat'] == c and i.get('sub') and i['sub'] not in subs: subs.append(i['sub'])
    cats.append({'name': c, 'subs': subs, 'count': sum(1 for i in items if i['cat'] == c)})
sup = [{'code': fix(r.get('A')), 'name': fix(r.get('B')), 'type': fix(r.get('C')), 'products': fix(r.get('D')), 'notes': fix(r.get('E'))} for r in d['Suppliers'][1:] if r.get('A')]
doc = {
  'title': 'Aahsso Drinks Catalog — Cameroon', 'country': 'CM', 'currency': 'XAF', 'version': '2026-11', 'source': 'docs/aahsso_beverage_catalog_cameroon.xlsx',
  'notes': [{'title': a, 'text': b} for a, b in readme],
  'categories': cats,
  'packaging': [{'key': p, 'desc': PACK_DESC.get(p, p)} for p in col('B')],
  'priceTiers': col('C'), 'sweetness': col('F'),
  'confidence': [{'key': k, 'desc': CONF.get(k, '')} for k in col('E')],
  'suppliers': sup,
  'items': items,
}
s = json.dumps(doc, ensure_ascii=False, separators=(',', ':'))
assert 'RGB' not in s and 'PET' not in re.sub(r'PETR|PETIT|Pét|PETE', '', s), [m.start() for m in re.finditer('PET', s)][:5]
open(out, 'w').write(s)
print(len(items), 'items', len(s) // 1024, 'KB', [c['name'] + ':' + str(c['count']) for c in cats])
