"""Independent Python Decimal oracle; no imports from the TypeScript implementation.

Run with Python 3, optionally passing the owner's original math-check JSON.
The committed JSON is generated here and consumed read-only by Jest.
"""
from decimal import Decimal as D, getcontext, ROUND_FLOOR
import json
from pathlib import Path
import sys

getcontext().prec = 110

def text(v):
    if isinstance(v, D):
        return '0' if not v else format(v, 'f').rstrip('0').rstrip('.') if '.' in format(v, 'f') else format(v, 'f')
    if isinstance(v, dict):
        return {k: text(x) for k, x in v.items()}
    if isinstance(v, list):
        return [text(x) for x in v]
    return v

def pnl(i):
    spot = i['market'] == 'spot'
    d = D(1 if spot or i['side'] == 'long' else -1)
    e, x = D(i['entry']), D(i['exit'])
    l = D(1) if spot else D(i['leverage'])
    fe, fx, se, sx = [D(i[k])/100 for k in ['feeEntry','feeExit','slipEntry','slipExit']]
    h, k = (D(0) if spot else D(i['funding'])), D(i['fixedCosts'])
    ef, xf = e*(1+d*se), x*(1-d*sx)
    q = D(i['quantity']) if i['quantityMode']=='quantity' else D(i['margin'])*l/ef
    n, fo, fc = q*ef, q*ef*fe, q*xf*fx
    g = d*q*(xf-ef)
    net = g-fo-fc-h-k
    be = (n*(1+d*fe)+d*(h+k))/(q*(1-d*fx))
    return dict(quantity=q,entryExecution=ef,exitExecution=xf,notional=n,initialMargin=n/l,purchaseCost=n+fo,
                grossPnl=g,feeOpen=fo,feeClose=fc,funding=h,fixedCosts=k,netPnl=net,
                roi=net/(n+fo if spot else n/l)*100,breakEvenExecution=be if be>0 else None,
                breakEvenTarget=be/(1-d*sx) if be>0 else None)

def position(i):
    d=D(1 if i['side']=='long' else -1)
    b,e,s,l,c=[D(i[k]) for k in ['capital','entry','stop','leverage','fixedCosts']]
    r,fe,fs,se,ss=[D(i[k])/100 for k in ['riskPercent','feeEntry','feeStop','slipEntry','slipStop']]
    ef,sf=e*(1+d*se),s*(1-d*ss)
    loss=d*(ef-sf)+ef*fe+sf*fs
    cash=ef/l+ef*fe+sf*fs
    rb=b*r; qr=(rb-c)/loss
    qb=(D(i['budget'])-c)/cash if i.get('budget') else None
    q=min(qr,qb) if qb is not None else qr
    if i.get('step'):
        step=D(i['step']); q=(q/step).to_integral_value(rounding=ROUND_FLOOR)*step
    return dict(riskBudget=rb,lossPerUnit=loss,cashPerUnit=cash,qRisk=qr,qBudget=qb,quantity=q,
                notional=q*ef,margin=q*ef/l,plannedLoss=q*loss+c,reserved=q*cash+c,actualRisk=(q*loss+c)/b*100)

def liquidation(i):
    d=D(1 if i['side']=='long' else -1)
    e,q,l,a,c=[D(i[k]) for k in ['entry','quantity','leverage','additionalMargin','costs']]
    n=q*e; initial=n/l; m=initial+a-c; mm=n*D(i['maintenanceRate'])/100
    p=e-d*(m-mm)/q; zero=e-d*m/q
    return dict(notional=n,initialMargin=initial,margin=m,maintenanceMargin=mm,buffer=m-mm,
                liquidationPrice=p if m>mm and p>0 else None,zeroMarginPrice=zero if zero>0 else None,
                distancePercent=abs(e-p)/e*100 if m>mm and p>0 else None)

def rr(i):
    common=dict(market='futures',side=i['side'],entry=i['entry'],quantity=i['quantity'],quantityMode='quantity',margin='',leverage='1',
                feeEntry=i['feeEntry'],slipEntry=i['slipEntry'],funding='0',fixedCosts=i['fixedCosts'])
    a=pnl(dict(common,exit=i['stop'],feeExit=i['feeStop'],slipExit=i['slipStop']))
    z=pnl(dict(common,exit=i['target'],feeExit=i['feeTarget'],slipExit=i['slipTarget']))
    risk,reward=-a['netPnl'],z['netPnl']
    return dict(risk=risk,reward=reward,ratio=reward/risk if reward>0 else None,
                breakEvenWinRate=risk/(risk+reward)*100 if reward>0 else None,stopPnl=-risk,targetPnl=reward)

def dca(i):
    q=bare=fees=D(0)
    for row in i['rows']:
        p,f=D(row['price']),D(row['fee'])/100
        qty=D(row['quantity']) if row['mode']=='quantity' else D(row['amount'])/p
        amount=D(row['amount']) if row['mode']=='amount' else qty*p
        q+=qty; bare+=amount; fees+=amount*f
    cost=bare+fees
    out=dict(quantity=q,purchaseSum=bare,entryFees=fees,costBasis=cost,averageBare=bare/q,averageCost=cost/q,exit=None,targetAverage=None)
    if 'exit' in i:
        x,fx=D(i['exit']['price']),D(i['exit']['fee'])/100
        out['exit']=dict(valueBeforeExitFee=q*x,exitFee=q*x*fx,netAtTarget=q*x*(1-fx)-cost,breakEven=cost/(q*(1-fx)))
    if 'targetAverage' in i:
        t=i['targetAverage']; p,f,target=D(t['price']),D(t['fee'])/100,D(t['target'])
        extra=(cost-target*q)/(target-p*(1+f))
        out['targetAverage']=dict(quantity=extra,amountBeforeFee=extra*p,totalNewCost=extra*p*(1+f),newQuantity=q+extra,newAverage=(cost+extra*p*(1+f))/(q+extra))
    return out

def fees(i):
    ne=D(i['notionalEntry']) if i['inputMode']=='notional' else D(i['quantity'])*D(i['entry'])
    nx=(D(i['notionalExit']) if i['inputMode']=='notional' else D(i['quantity'])*D(i['exit'])) if i['includeExit'] else None
    m,t=D(i['makerRate'])/100,D(i['takerRate'])/100
    fo=ne*(m if i['entryRole']=='maker' else t)
    fc=nx*(m if i['exitRole']=='maker' else t) if nx is not None else None
    total=fo+(fc if fc is not None else 0)
    comb={a+b:ne*x+(nx*y if nx is not None else 0) for a,x in [('M',m),('T',t)] for b,y in [('M',m),('T',t)]}
    funding=None
    if i['market']=='futures' and 'funding' in i:
        f=i['funding'];funding=D(1 if i['side']=='long' else -1)*D(f['notional'])*D(f['rate'])/100*D(f['periods'])
    return dict(notionalEntry=ne,notionalExit=nx,feeOpen=fo,feeClose=fc,feesTotal=total,combinations=comb,fundingCost=funding,netCost=total+funding if funding is not None else None)

P=dict(market='futures',side='long',quantityMode='quantity',entry='60000',exit='66000',quantity='0.1',margin='',leverage='10',feeEntry='0.05',feeExit='0.05',slipEntry='0',slipExit='0',funding='0',fixedCosts='0')
S=dict(side='long',capital='10000',riskPercent='1',entry='100',stop='95',leverage='5',feeEntry='0',feeStop='0',slipEntry='0',slipStop='0',fixedCosts='0',budget='',step='')
L=dict(side='long',entry='100',quantity='10',leverage='10',maintenanceRate='0.5',additionalMargin='0',costs='0')
R=dict(side='long',entry='100',stop='95',target='110',quantity='1',feeEntry='0',feeStop='0',feeTarget='0',slipEntry='0',slipStop='0',slipTarget='0',fixedCosts='0')
DCA=dict(rows=[dict(mode='quantity',price='10000',quantity='1',amount='',fee='0'),dict(mode='quantity',price='20000',quantity='2',amount='',fee='0')])
F=dict(market='futures',side='long',inputMode='notional',quantity='',entry='',exit='',notionalEntry='6000',notionalExit='6600',includeExit=True,entryRole='maker',exitRole='taker',makerRate='0.02',takerRate='0.055')

cases=[]
def add(name,mode,input):
    value={'pnl':pnl,'position':position,'liquidation':liquidation,'riskReward':rr,'dca':dca,'fees':fees}[mode](input)
    cases.append(dict(name=name,mode=mode,input=input,expected=text(value)))
    return value

a=add('A Long','pnl',P)
lev=add('A leverage 20','pnl',dict(P,leverage='20'))
b=add('B Short','pnl',dict(P,side='short',exit='54000'))
slipbase=dict(P,entry='100',exit='110',quantity='10',leverage='5',feeEntry='0.1',feeExit='0.1',slipEntry='1',slipExit='1')
c=add('C adverse Long','pnl',slipbase)
cs=add('C adverse Short','pnl',dict(slipbase,side='short',exit='90'))
loss=add('C losing Long','pnl',dict(slipbase,exit='90',slipEntry='0',slipExit='0'))
received=add('C received funding','pnl',dict(slipbase,exit='90',slipEntry='0',slipExit='0',funding='-2'))
add('Spot ignores hidden futures fields','pnl',dict(P,market='spot',side='short',leverage='99',funding='-100'))
add('Margin source','pnl',dict(P,quantityMode='margin',quantity='',margin='600'))
add('Small price large quantity','pnl',dict(P,entry='0.0000000123',exit='0.0000000246',quantity='1000000000000'))
add('More than 15 significant figures','pnl',dict(P,entry='123456789012345.123456789',exit='123456789012346.123456789',quantity='0.123456789012345678901234'))
add('D position no costs','position',S)
sz=add('E position step','position',dict(S,feeEntry='0.1',feeStop='0.1',step='0.01'))
sb=add('E budget cap','position',dict(S,feeEntry='0.1',feeStop='0.1',step='0.01',budget='200'))
for step in ['0.001','0.005','1','10']:
    add('Position Short step '+step,'position',dict(S,side='short',stop='105',feeEntry='0.1',feeStop='0.1',step=step))
ll=add('F Long','liquidation',L)
ls=add('F Short','liquidation',dict(L,side='short'))
lla=add('F Long extra margin','liquidation',dict(L,additionalMargin='50'))
lsa=add('F Short extra margin','liquidation',dict(L,side='short',additionalMargin='50'))
add('G zero costs','riskReward',R)
rg=add('G costs','riskReward',dict(R,feeEntry='0.1',feeStop='0.1',feeTarget='0.1'))
add('G Short','riskReward',dict(R,side='short',stop='105',target='90'))
dc=add('H bare average','dca',DCA)
dcf=add('H fees and target','dca',dict(rows=[dict(row,fee='0.1') for row in DCA['rows']],exit=dict(price='18000',fee='0.1')))
dct=add('H target average','dca',dict(DCA,targetAverage=dict(price='10000',fee='0',target='15000')))
add('DCA exact amount before fee','dca',dict(rows=[dict(mode='amount',price='3',quantity='',amount='1',fee='0.1')]))
fee=add('I fees','fees',F)
fl=add('I Long funding','fees',dict(F,funding=dict(notional='6000',rate='0.01',periods='3')))
fs=add('I Short funding','fees',dict(F,side='short',funding=dict(notional='6000',rate='0.01',periods='3')))
add('Fees single leg','fees',dict(F,includeExit=False,notionalExit=''))
add('Fees quantity input','fees',dict(F,inputMode='quantity',quantity='0.1',entry='60000',exit='66000',notionalEntry='',notionalExit=''))

checks={
 'P&L Long / notional':a['notional'],'P&L Long / margin':a['initialMargin'],'P&L Long / gross':a['grossPnl'],
 'P&L Long / feeEntry':a['feeOpen'],'P&L Long / feeExit':a['feeClose'],'P&L Long / net':a['netPnl'],'P&L Long / roi':a['roi'],
 'Leverage invariance / net':lev['netPnl'],'Leverage change / ROI':lev['roi'],'P&L Short / net':b['netPnl'],'P&L Short / ROI':b['roi'],
 'Long adverse slippage / net':c['netPnl'],'Short adverse slippage / net':cs['netPnl'],'Losing Long / net':loss['netPnl'],
 'Received funding / net improvement':received['netPnl']-loss['netPnl'],
 'Break-even substitution / direction 1':pnl(dict(P,exit=text(a['breakEvenTarget'])))['netPnl'],
 'Break-even substitution / direction -1':pnl(dict(P,side='short',exit=text(b['breakEvenTarget'])))['netPnl'],
 'Position size / quantity':sz['quantity'],'Position size / planned loss':sz['plannedLoss'],'Position size / margin':sz['margin'],
 'Budget-limited size / quantity':sb['quantity'],'Budget-limited size / reserve':sb['reserved'],'Budget-limited size / loss':sb['plannedLoss'],
 'Liquidation entry-notional model / Long A=0':ll['liquidationPrice'],'Liquidation entry-notional model / Short A=0':ls['liquidationPrice'],
 'Liquidation entry-notional model / Long A=50':lla['liquidationPrice'],'Liquidation entry-notional model / Short A=50':lsa['liquidationPrice'],
 'Risk/reward / risk':rg['risk'],'Risk/reward / reward':rg['reward'],'Risk/reward / ratio':rg['ratio'],'Risk/reward / break-even percent':rg['breakEvenWinRate'],
 'DCA / bare cost':dc['purchaseSum'],'DCA / cost basis':dcf['costBasis'],'DCA / net at target':dcf['exit']['netAtTarget'],
 'DCA / exit break-even':dcf['exit']['breakEven'],'DCA target-average / additional quantity':dct['targetAverage']['quantity'],
 'Fees / MM':fee['combinations']['MM'],'Fees / MT':fee['combinations']['MT'],'Fees / TM':fee['combinations']['TM'],'Fees / TT':fee['combinations']['TT'],
 'Funding / Long':fl['fundingCost'],'Funding / Short':fs['fundingCost'],
}
reference_path = Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).with_name('owner-reference.json')
if reference_path.exists():
    reference=json.loads(reference_path.read_text(encoding='utf-8-sig'))
    assert len(checks)==len(reference['checks'])==42
    for item in reference['checks']:
        actual,expected=checks[item['check']],D(item['expected'])
        tolerance=abs(expected)*D('1e-18') if expected else D('1e-70')
        assert abs(actual-expected)<=tolerance,(item['check'],actual,expected)
    print('Owner reference independently verified: 42/42; no numerical inconsistencies.')

output=Path(__file__).with_name('oracle.json')
output.write_text(json.dumps(dict(source='Python Decimal, precision 110; generated independently of TypeScript',relativeTolerance='1e-80',cases=cases),ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(f'Wrote {len(cases)} independent fixture cases to {output.name}.')
