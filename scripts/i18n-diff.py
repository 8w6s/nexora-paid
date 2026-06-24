import json, sys, os
base = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'src', 'i18n', 'locales')
def flat(o, p=''):
    out = {}
    for k, v in o.items():
        np = f'{p}.{k}' if p else k
        if isinstance(v, dict):
            out.update(flat(v, np))
        else:
            out[np] = v
    return out
def load(name):
    with open(os.path.join(base, name + '.json'), encoding='utf-8') as f:
        return flat(json.load(f))
en = load('en')
en_keys = set(en)
for loc in ['vi', 'zh', 'es', 'de']:
    d = load(loc)
    k = set(d)
    missing = sorted(en_keys - k)
    extra = sorted(k - en_keys)
    untranslated = sorted([key for key in en_keys & k if d[key] == en[key] and not en[key].startswith('$')])
    print(f'--- {loc} ---')
    if missing:
        print(f'  MISSING ({len(missing)}):')
        for m in missing:
            print(f'    {m}  =  "{en[m]}"')
    if extra:
        print(f'  EXTRA ({len(extra)}): {extra}')
    if untranslated and loc != 'en':
        print(f'  UNTRANSLATED ({len(untranslated)}): first 10 =', untranslated[:10])