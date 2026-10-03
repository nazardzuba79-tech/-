import { useState, useSyncExternalStore } from 'react';
import { getToken, onSessionChange } from '../../lib/api';
import { CashList, CashDetailPanel } from '../otc/OtcCashDesk';
import '../otc/otc-cash.css';
export function AdminOtcCashPage(){const token=useSyncExternalStore(onSessionChange,getToken,()=>null);return <AdminDesk key={token}/>;}
function AdminDesk(){const [id,setId]=useState<string|null>(null);return <div className="otc-admin-desk"><h1>OTC-заявки</h1><p>Резервирование, согласованные условия и подтверждение фактической выдачи наличных. Без автоматического исполнения.</p><div hidden={id!==null}><CashList admin active={id===null} onOpen={setId}/></div>{id&&<CashDetailPanel key={id} id={id} admin onClose={()=>setId(null)}/>}</div>;}
