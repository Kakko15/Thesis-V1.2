import sys, re
sys.path.insert(0, '.')
import services.guards as g
from tests.test_guards_multilingual import MUST_ALLOW, MUST_REFUSE

# Compound NEW-TOPIC object as ONE unit (not verb+modifier+artifact).
DOMAIN = r'(?:thesis|tesis|tisis|research|capstone|study|pananaliksik|saliksik|dissertation|sp|undergrad)'
HEAD   = r'(?:idea|ideas|ideya|ideyas|topic|topics|topiko|paksa|title|titles|titulo|pamagat|proposal)'
NEWOBJ = rf'(?:(?:{DOMAIN}[\s-]*)?{HEAD}|{HEAD}[\s-]*(?:para|for)?)'
BARE   = r'(?:idea|ideas|ideya|paksa)'
BENEF  = (r'(?:\bfor\s+(?:me|us|my|our)\b|\bpara\s+sa\s+(?:akin|amin|kin|aking|aming)\b'
          r'|\bpara\s+(?:sa|iti)\s+\w*\s*(?:ko|namin|mi|natin)\b|\bkaniak\b|\bkadakami\b'
          r'|\bmo\s+(?:ako|ko|kami)\b|\bako\s+ng\b|\bkong?\s+gawin\b|\bgagawin\s+ko\b'
          r'|\bmy\s+(?:own\s+)?(?:thesis|capstone|study|research)\b|\btesis\s*(?:ko|mi|namin)\b|\btesisko\b|\btesismi\b)')
VERB   = (r'(?:recommend|suggest|propose|advise|brainstorm|ideate|think\s+of|come\s+up\s+with'
          r'|mag[\s-]?(?:rekomenda|suggest|mungkahi|bigay|isip)|i[\s-]?(?:rekomenda|suggest|mungkahi)'
          r'|irekomendam|imungkahi|mungkahian|maimumungkahi|maisuggest|mairerekomenda'
          r'|bigyan|bigay|pabigay|pakibigay|pahingi|give|mangited|ited|itedmo|agsuggest|need|want)')
PAT = re.compile(rf'\b{VERB}\b[^.!?]{{0,30}}?\b{NEWOBJ}\b|\b{NEWOBJ}\b[^.!?]{{0,30}}?\b{VERB}\b', re.I)
def refuse(t):
    n = re.sub(r'\s+',' ',t or '').strip()
    if g.prohibited_reason(n): return True
    return bool(PAT.search(n) and re.search(BENEF, n, re.I))

TARGETS=[l.strip() for l in open('/tmp/targets.txt',encoding='utf8')] if False else None
exec(open('/tmp/probe6.py').read().split('TARGETS = [')[1].split(']\nmiss')[0].join(['TARGETS = [',']']))
SHADOW=["recommend theses about OCR","suggest papers similar to mine","suggest related studies",
 "what topics does the archive cover","anong tesis ang pwede kong basahin tungkol sa computer vision",
 "recommend a thesis I can use as a reference for my RRL","suggest studies for my thesis",
 "suggest theses related to my topic","magrekomenda ka ng tesis tungkol sa OCR",
 "ibigay mo ang pamagat ng tesis na iyon","ilista mo ang mga paksa ng tesis dito",
 "ano ang paksa ng tesis na iyon","bigyan mo ako ng listahan ng tesis tungkol sa AI",
 "pahingi ng listahan ng tesis","magsuggest ka ng pag-aaral na katulad ng tesis ko",
 "irekomenda mo ang tesis na dapat kong basahin","ited mo kaniak dagiti pamagat dagiti tesis ditoy",
 "ano ang pwede kong maging thesis topic base sa archive"]
print(f'targets refused : {sum(map(refuse,TARGETS))}/{len(TARGETS)}')
for t in TARGETS:
    if not refuse(t): print('   MISS', t)
print(f'\nMUST_ALLOW regressions: {sum(map(refuse,MUST_ALLOW))}')
for q in MUST_ALLOW:
    if refuse(q): print('   X', q)
print(f'\nMUST_REFUSE still refused: {sum(map(refuse,MUST_REFUSE))}/{len(MUST_REFUSE)}')
print('\nshadow allow false-refusals:')
for s in SHADOW:
    if refuse(s): print('   X', s)
