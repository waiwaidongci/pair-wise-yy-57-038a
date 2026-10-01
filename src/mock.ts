import type { ExecutionRecord, StationDevice, TestCase } from './types'

export const devices: StationDevice[] = [
  { id:'P-01',name:'1# 道岔',kind:'道岔',x:18,y:58,routeIds:['R-01','R-02'] },
  { id:'P-02',name:'2# 道岔',kind:'道岔',x:42,y:58,routeIds:['R-01','R-03'] },
  { id:'P-03',name:'3# 道岔',kind:'道岔',x:67,y:58,routeIds:['R-02','R-04'] },
  { id:'X-01',name:'X 进站信号机',kind:'信号机',x:9,y:35,routeIds:['R-01','R-03'] },
  { id:'S-01',name:'S 出站信号机',kind:'信号机',x:88,y:35,routeIds:['R-01','R-02','R-04'] },
  { id:'S-02',name:'S2 出站信号机',kind:'信号机',x:74,y:78,routeIds:['R-02','R-04'] },
  { id:'T-01',name:'1G 轨道区段',kind:'轨道区段',x:29,y:45,routeIds:['R-01','R-02'] },
  { id:'T-02',name:'2G 轨道区段',kind:'轨道区段',x:55,y:45,routeIds:['R-01','R-03','R-04'] },
  { id:'T-03',name:'3G 轨道区段',kind:'轨道区段',x:77,y:65,routeIds:['R-02','R-04'] },
]

export const routes = [
  { id:'R-01',name:'X → 1G → S',color:'#2563eb',points:[[9,35],[18,35],[18,58],[42,58],[42,45],[88,45],[88,35]] as [number,number][],devices:['X-01','P-01','P-02','T-01','T-02','S-01'],affectedBy:['P-02 转辙机更换'] },
  { id:'R-02',name:'X → 2G → S2',color:'#059669',points:[[9,35],[18,35],[18,58],[42,58],[67,58],[67,65],[74,65],[74,78],[88,78]] as [number,number][],devices:['X-01','P-01','P-02','P-03','T-01','T-03','S-02'],affectedBy:['P-02 转辙机更换','T-03 绝缘节调整'] },
  { id:'R-03',name:'X → 2G → S',color:'#d97706',points:[[9,35],[18,35],[18,58],[42,58],[42,45],[88,45],[88,35]] as [number,number][],devices:['X-01','P-01','P-02','T-02','S-01'],affectedBy:['P-02 转辙机更换'] },
  { id:'R-04',name:'2G → 3G → S2',color:'#7c3aed',points:[[42,45],[67,45],[67,58],[67,65],[74,65],[74,78],[88,78]] as [number,number][],devices:['P-03','T-02','T-03','S-02'],affectedBy:['T-03 绝缘节调整'] },
]

/** 升级前（联锁 CS-v26.09）的关系快照种子，指纹由 store 按关系数据重算 */
export const SNAPSHOT_PREV_ID = 'SNP-2609-01'
export const SNAPSHOT_PREV = {
  id: SNAPSHOT_PREV_ID,
  version: 'v26.09',
  label: 'CS-LEU-08 联锁基线',
  fingerprint: '',
  createdAt: '2026-09-01 09:00',
  changedDeviceIds: [],
  changedRouteIds: [],
  changeNote: '升级前稳定基线',
  caseIds: ['TC-101','TC-102','TC-103'],
  executionIds: ['EX-260929-04','EX-260929-03','EX-260929-02'],
  verified: true,
  verifiedAt: '2026-09-29 17:00',
}

export const seedCases: TestCase[] = [
  { id:'TC-101',name:'X 至 S 正线接车进路建立',routeIds:['R-01'],precondition:'1G、2G 空闲，道岔在定位，无敌对进路',version:'v26.09',snapshotId:SNAPSHOT_PREV_ID,valid:true,status:'通过',steps:[{id:'TS-1',action:'排列 X → S 接车进路',expected:'X 信号开放，P-01/P-02 锁闭',result:'通过',actual:'信号开放，联锁状态一致',evidence:'截图 XS-026',evidenceValid:true},{id:'TS-2',action:'人工扳动 P-02',expected:'道岔锁闭，操作被拒绝',result:'通过',actual:'拒绝并记录操作',evidence:'日志 LG-108',evidenceValid:true}] },
  { id:'TC-102',name:'X 至 S2 侧线接车与3G占用',routeIds:['R-02'],precondition:'3G 空闲，P-03 反位',version:'v26.09',snapshotId:SNAPSHOT_PREV_ID,valid:true,status:'执行中',steps:[{id:'TS-3',action:'排列 X → S2 侧线进路',expected:'X、S2 信号开放，P-03 锁闭反位',result:'通过',actual:'进路建立正常',evidence:'截图 XS-031',evidenceValid:true},{id:'TS-4',action:'模拟 3G 轨道区段占用',expected:'立即关闭 S2 信号，保持进路锁闭',result:'未执行'}] },
  { id:'TC-103',name:'敌对进路 R-01 / R-02 互锁',routeIds:['R-01','R-02'],precondition:'1G 空闲，P-01/P-02 可转换',version:'v26.09',snapshotId:SNAPSHOT_PREV_ID,valid:true,status:'失败',failureReason:'实测可短暂同时开放 X 信号，疑似软件版本差异',steps:[{id:'TS-5',action:'建立 R-01 后尝试排列 R-02',expected:'拒绝排列并保持 R-01 锁闭',result:'失败',actual:'R-02 请求进入等待态，X 信号未保持',evidence:'录屏 VID-014、日志 LG-119',evidenceValid:true}] },
  { id:'TC-104',name:'2G 至3G 调车进路和绝缘节',routeIds:['R-04'],precondition:'T-02、T-03 空闲',version:'v26.10',snapshotId:'',valid:false,status:'阻塞',failureReason:'等待 T-03 绝缘节调整完成',steps:[{id:'TS-6',action:'排列 2G → 3G 调车进路',expected:'D 信号开放，P-03 反位锁闭',result:'未执行'}] },
]

export const seedExecutions: ExecutionRecord[] = [
  { id:'EX-260929-04',caseId:'TC-103',operator:'陆晨',startedAt:'16:10',finishedAt:'16:38',snapshot:'v26.09 / CS-LEU-08',snapshotId:SNAPSHOT_PREV_ID,result:'失败',evidence:['VID-014','LG-119'],evidenceValid:true,source:'在线',state:'生效' },
  { id:'EX-260929-03',caseId:'TC-101',operator:'陆晨',startedAt:'15:20',finishedAt:'15:44',snapshot:'v26.09 / CS-LEU-08',snapshotId:SNAPSHOT_PREV_ID,result:'通过',evidence:['XS-026','LG-108'],evidenceValid:true,source:'在线',state:'生效' },
  { id:'EX-260929-02',caseId:'TC-102',operator:'方瑜',startedAt:'14:52',snapshot:'v26.09 / CS-LEU-08',snapshotId:SNAPSHOT_PREV_ID,result:'执行中',evidence:['XS-031'],evidenceValid:true,source:'在线',state:'生效' },
  // 旧记录：缺少快照/版本与来源，首次载入时按设备关系补齐
  { id:'EX-260815-07',caseId:'TC-101',operator:'韩工',startedAt:'2026-08-15 10:05',finishedAt:'2026-08-15 10:26',snapshot:'',result:'通过',evidence:['纸质记录扫描 SC-0815-07'],evidenceValid:true,source:'旧记录补齐',state:'生效' },
]
