#!/usr/bin/env python3
"""Check every ordinary fall service date against the captain workbook (openpyxl)."""
import csv
import datetime as dt
import json
import re
from collections import defaultdict
from pathlib import Path
import openpyxl
ROOT=Path(__file__).resolve().parent.parent

def read(name):
    with (ROOT/'gtfs'/f'{name}.txt').open() as f:return list(csv.DictReader(f))
def norm(s):return re.sub('[^a-z0-9]','',str(s).lower())
ALIASES={
 '87':['Wall Street/Pier 11'], '20':['DUMBO'], '8':['South Williamsburg'],
 '19':['North Williamsburg'], '18':['Greenpoint'], '4':['Hunters Point South'],
 '17':['E. 34th Street','East 34th St'], '88':['Rockaway'], '118':['Sunset Park'],
 '114':['Stuyvesant Cove'], '113':['E. 90th Street','E.90th Street'],
 '112':['Soundview'], '141':['Ferry Point Park'], '115':['Corlears Hook'],
 '11':['Atlantic Avenue/BBP Pier 6'], '24':['Red Hook'], '111':['Governors Island'],
 '120':['B.N.Y'], '90':['Long Island City'], '25':['Roosevelt Island'],
 '89':['Astoria'], '138':['Pier 79'], '136':['Battery Park City'],
 '137':['St. George'], '23':['Bay Ridge'],
}
alias={norm(v):k for k,vals in ALIASES.items() for v in vals}
w=openpyxl.load_workbook(ROOT/'schedules/fall-2026.xlsx',data_only=True)
route_sheets={'ER':'ER','RS':'RW-SV','SB':'SB','AS':'AST','SG':'STG'}
expected={}
for route,prefix in route_sheets.items():
 for kind in ['WKDY','WKND']+(['MOD'] if route=='SB' else []):
  data={}
  for direction in ['IN','OUT']:
   s=w[f'{prefix} {kind} {direction}'];rows=list(s.values);headers=rows[2]
   for row in rows[4:]:
    nums=[(i,int(v)) for i,v in enumerate(row[:2]) if isinstance(v,(int,float)) and v>=1000]
    if not nums:continue
    col,n=nums[0];boat=int(row[1-col]);calls=[]
    for i,v in enumerate(row[2:],2):
     if isinstance(v,dt.time):calls.append((alias[norm(headers[i])],v.strftime('%H:%M:%S')))
    assert n not in data,(s.title,n)
    data[n]=(boat,calls)
  expected[(route,kind)]=data
calendar=read('calendar');exceptions=read('calendar_dates');trips=read('trips')
times=defaultdict(list)
for call in read('stop_times'):times[call['trip_id']].append(call)
for calls in times.values():calls.sort(key=lambda c:int(c['stop_sequence']))
assign=json.loads((ROOT/'content/boat-assignments.json').read_text())['assignments']
holidays=set(json.loads((ROOT/'schedules/sukkot-2026.json').read_text())['dates'])
verified=0;dates=0
for offset in range(49):
 date=dt.date(2026,9,14)+dt.timedelta(days=offset);key=date.strftime('%Y%m%d')
 active={c['service_id'] for c in calendar if c['start_date']<=key<=c['end_date'] and c[date.strftime('%A').lower()]=='1'}
 for e in exceptions:
  if e['date']==key:
   if e['exception_type']=='1':active.add(e['service_id'])
   else:active.discard(e['service_id'])
 today=[t for t in trips if t['service_id'] in active]
 if date.isoformat() in holidays:
  assert not today,'Ordinary trips leaked into Sukkot'
  continue
 for route in route_sheets:
  kind='WKDY' if date.weekday()<5 else ('MOD' if route=='SB' and active & {'7','8'} else 'WKND')
  expect=expected[(route,kind)]
  actual=[t for t in today if t['route_id']==route]
  assert len(actual)==len(expect),(date,route,len(actual),len(expect))
  assert {int(t['trip_short_name']) for t in actual}==set(expect),(date,route,'trip numbers')
  for trip in actual:
   boat,calls=expect[int(trip['trip_short_name'])]
   ts=times[trip['trip_id']]
   actual_calls=[(c['stop_id'],c['arrival_time'] if i==len(ts)-1 else c['departure_time']) for i,c in enumerate(ts)]
   assert calls==actual_calls,(date,route,trip['trip_short_name'],calls,actual_calls)
   assert assign[trip['trip_short_name']]==boat,(date,route,trip['trip_short_name'],'boat')
   verified+=1
 dates+=1
print(f'PASS: {verified} trip instances across {dates} ordinary fall dates match every stop, printed time and boat assignment; five Sukkot dates exclude ordinary trips.')
