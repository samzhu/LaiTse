from pathlib import Path
import json,hashlib
out=Path('docs/poc/evidence/POC-RM-01-R001')
report=json.loads((out/'confirmed/report.json').read_text());db=json.loads((out/'postgres-readback.json').read_text())
assert report['status']=='passed' and len(report['cases'])==13 and not report['errors']['pageErrors'] and not report['errors']['cappedCollections']
cases={x['name']:x for x in report['cases']};states=0;ids=set()
for client in report['controls']:
 current=None
 for message in client['messages']:
  if message['type'] in ['session.issued','session.resumed']:
   current=message['participantId'];ids.add(current)
  if message['type']=='room.management.state':
   states+=1
   if message['isOwner']:assert current and message.get('ownerParticipantId')==current
   else:assert 'ownerParticipantId' not in message and 'memberIds' not in message
initial=cases['same display name received distinct server participant IDs'];assert initial['ownerParticipantId']!=initial['peerParticipantId']
manual=cases['manual transfer selected an online studio member'];elected=cases['offline manager handed control to an eligible studio member']
assert elected['selectedParticipantId'] in elected['eligibleParticipantIds'] and len(elected['eligibleParticipantIds'])==2
assert not elected['fairnessAssessed']
empty=cases['empty studio stayed locked while its manager remained online in lobby'];assert empty['isLocked'] and empty['roomMemberCount']==0
cleared=cases['offline manager with no target-room candidates left the room unlocked'];assert not cleared['isLocked'] and cleared['lockKind']=='none'
fresh=cases['newly joined member relocked the room and became its manager'];assert fresh['participantId']!=manual['toParticipantId']
rows=[x for x in db['audit'] if x['actor_participant_id'] in ids or x['target_participant_id'] in ids]
expected=['room.anonymous_locked','room.anonymous_manager.transferred','room.anonymous_password_changed','room.anonymous_manager.auto_transferred','room.anonymous_manager.auto_unlocked','room.anonymous_locked','room.anonymous_manager.auto_unlocked']
assert [x['action'] for x in rows]==expected
assert rows[0]['actor_participant_id']==initial['ownerParticipantId']
assert (rows[1]['actor_participant_id'],rows[1]['target_participant_id'])==(manual['fromParticipantId'],manual['toParticipantId'])
assert (rows[3]['actor_participant_id'],rows[3]['target_participant_id'])==(manual['toParticipantId'],elected['selectedParticipantId'])
assert rows[4]['actor_participant_id']==elected['selectedParticipantId'] and rows[4]['target_participant_id'] is None
assert rows[5]['actor_participant_id']==fresh['participantId']
studio=next(x for x in db['settings'] if x['room_id']=='studio');assert not studio['is_locked'] and studio['lock_kind']=='none' and studio['manager_participant_id'] is None and studio['salt_cleared'] and studio['verifier_cleared']
assert [x['version'] for x in db['migrations']]==['001_system_persistence.sql','002_anonymous_room_management.sql']
media=json.loads((out/'media-regression/report.json').read_text());assert media['status']=='passed'
T={x['client'].split('-')[-1]:x for x in media['transport']};channels={}
for channel in ['audio','screen']:
 owners={}
 for name,t in T.items():
  for p in t['packetHashTrace']['sent'][channel]:owners.setdefault((p['generation'],p['sha256']),set()).add(name)
 results={}
 for name,t in T.items():
  counts={};unknown=selfs=ambiguous=0
  assert all(n==0 for d in t['droppedPacketRecords'].values() for n in d.values())
  for p in t['packetHashTrace']['received'][channel]:
   found=owners.get((p['generation'],p['sha256']),set());unknown+=int(not found);selfs+=int(name in found);ambiguous+=int(len(found)>1)
   for actor in found:counts[actor]=counts.get(actor,0)+1
  assert unknown==selfs==ambiguous==0
  results[name]={'ownerCounts':counts,'received':sum(counts.values()),'unknown':unknown,'self':selfs,'ambiguous':ambiguous}
 assert results['D']['received']==0
 if channel=='audio':assert set(results['A']['ownerCounts'])=={'B'} and set(results['B']['ownerCounts'])=={'A'} and set(results['C']['ownerCounts'])=={'A','B'}
 else:assert set(results['C']['ownerCounts'])=={'A'} and len(T['B']['packetHashTrace']['sent']['screen'])==0
 channels[channel]=results
hashes=json.loads((out/'source-sha256.json').read_text());assert all(hashlib.sha256(Path(path).read_bytes()).hexdigest()==value for path,value in hashes.items())
result={'reviewer':'root','roomManagementCore':'Pass within trusted Firefox/PostgreSQL fixture','browserDurationMs':report['durationMs'],'cases':len(report['cases']),'privateOwnerStatesChecked':states,'sameNameIdsDistinct':True,'databaseMatchingAuditIds':[x['audit_id'] for x in rows],'databaseMatchingActions':expected,'election':elected,'emptyRoomOnlineOwnerRetained':True,'formerOwnerDidNotReclaim':True,'finalDatabaseCleared':True,'migrations':db['migrations'],'positiveOwnerUnlockProtocolAndDB':json.loads((out/'owner-unlock-check.json').read_text())['status'],'mediaPGRegression':{'durationMs':media['durationMs'],'activeMediaMs':media['activeMediaDurationMs'],'channels':channels},'sourceHashesMatched':len(hashes),'screenshotsActuallyViewed':['confirmed/screenshots/locked-owner.png','confirmed/screenshots/fresh-member-relocked.png'],'humanAcceptance':'not collected; automated UI only','randomnessFairness':'not statistically assessed; production crypto.randomInt / deterministic seam membership cases'}
(out/'root-readback.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'states':states,'auditIds':result['databaseMatchingAuditIds'],'sourceHashes':len(hashes),'roomBrowserMs':report['durationMs'],'media':channels},ensure_ascii=False))
