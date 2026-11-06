import json,hashlib,pathlib
out=pathlib.Path('docs/poc/evidence/POC-MA-01-R001')
x=json.loads((out/'confirmed/report.json').read_text())
assert x['status']=='passed'
T={t['client'].split('-')[-1]:t for t in x['transport']}
for t in T.values():
 assert all(n==0 for d in t['droppedPacketRecords'].values() for n in d.values())
channels={}
for channel in ['audio','screen']:
 owners={}
 for name,t in T.items():
  for p in t['packetHashTrace']['sent'][channel]:owners.setdefault((p['generation'],p['sha256']),set()).add(name)
 result={}
 for name,t in T.items():
  counts={};unknown=selfs=ambiguous=0
  for p in t['packetHashTrace']['received'][channel]:
   found=owners.get((p['generation'],p['sha256']),set())
   if not found:unknown+=1
   if len(found)>1:ambiguous+=1
   if name in found:selfs+=1
   for actor in found:counts[actor]=counts.get(actor,0)+1
  assert unknown==0 and selfs==0 and ambiguous==0,(channel,name,unknown,selfs,ambiguous)
  result[name]={'received':len(t['packetHashTrace']['received'][channel]),'ownerCounts':counts,'unknown':unknown,'self':selfs,'ambiguous':ambiguous}
 assert result['D']['received']==0
 if channel=='audio':
  assert set(result['A']['ownerCounts'])=={'B'} and set(result['B']['ownerCounts'])=={'A'}
  assert set(result['C']['ownerCounts'])=={'A','B'}
 else:
  assert set(result['C']['ownerCounts'])=={'A'}
  assert len(T['B']['packetHashTrace']['sent'][channel])==0
 channels[channel]=result
checks={c['name']:c for c in x['checks']}
stop=checks['A-stop-does-not-break-B'];assert stop['bRenderedPcmSamplesAfter']>stop['bRenderedPcmSamplesBefore']
a=x['sourceStreams']['audio'];assert a['afterRestart']['A']['currentGeneration']!=a['afterRestart']['A']['oldGeneration']
for target,rows in a['initial']['receiverPCM'].items():
 assert all(r['renderedPcmSamples']>0 and r['decodedFrames']>0 and r['renderRms']>0 for r in rows if r['active'])
re=x['reconnect'];assert re['newConnectionIndex']>re['oldConnectionIndex']
assert len([r for r in re['receiverPCM'] if r['active'] and r['renderedPcmSamples']>0])==2
quiet=x['interactionMode']['quietWindowStartedAtMs']
assert not [p for ch in ['audio','screen'] for p in T['C']['packetHashTrace']['received'][ch] if p['atMs']>=quiet]
iso=x['roomIsolation']['roomSnapshotAtMs']
controls=[c for conn in T['C']['connections'] for c in conn['controls']]
back=min(c['atMs'] for c in controls if c['type']=='room.snapshot' and c.get('roomId')=='studio' and c['atMs']>iso)
assert not [p for ch in ['audio','screen'] for p in T['C']['packetHashTrace']['received'][ch] if iso<p['atMs']<back]
assert not any(x['errors'].get(k) for k in ['pageErrors','socketErrors','cleanupErrors','failure'])
sha=json.loads((out/'source-sha256.json').read_text())
assert all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==v for p,v in sha.items())
result={'reviewer':'root','basis':'independently recomputed every received packet generation/hash against captured publisher hashes; no raw media stored','reportSHA256':hashlib.sha256((out/'confirmed/report.json').read_bytes()).hexdigest(),'sourceHashesMatched':len(sha),'status':'Pass within synthetic desktop memory fixture','channels':channels,'AStopBPCM':{'before':stop['bRenderedPcmSamplesBefore'],'after':stop['bRenderedPcmSamplesAfter']},'CRecoveredSourcePCM':re['receiverPCM'],'quietWindow':{'startMs':quiet,'audioAndScreenReceived':0},'roomSwitchWindow':{'startMs':iso,'returnRoomSnapshotMs':back,'studioMediaReceived':0},'screenshotsActuallyViewed':['confirmed/c-two-audio-sources.png'],'humanListening':'not tested','PostgreSQL':'not rerun; unavailable','wholeMVPGo':False}
(out/'root-readback.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'channels':channels,'sourceHashesMatched':len(sha),'reportStatus':x['status'],'durationMs':x['durationMs'],'activeMediaMs':x['activeMediaDurationMs'],'quietWindowReceived':0},ensure_ascii=False))
