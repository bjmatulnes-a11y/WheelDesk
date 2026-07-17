import type { IfPremiumSample, ZeroDteExecutionMemory, ZeroDteExecutionRead } from "./zeroDteExecutionIntelligence";
import type { ZeroDteOpeningMap } from "./zeroDteOpeningMap";
import type { ZeroDteOpeningTradePlan } from "./zeroDteOpeningTradePlan";
import type { ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteStrikeFlowRead } from "./zeroDteStrikeFlow";

async function call(body:Record<string,unknown>):Promise<ZeroDteExecutionMemory>{const r=await fetch("/api/zero-dte/execution",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),cache:"no-store"});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||"Execution persistence failed");return j.memory as ZeroDteExecutionMemory;}
export async function loadExecutionMemoryDb(tradeDate:string):Promise<ZeroDteExecutionMemory>{const r=await fetch(`/api/zero-dte/execution?tradeDate=${encodeURIComponent(tradeDate)}`,{cache:"no-store"});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||"Execution history load failed");return j.memory;}
export async function persistExecutionSample(args:{tradeDate:string;expirationDate:string|null;generatedAt:string;openingMap:ZeroDteOpeningMap;openingPlan:ZeroDteOpeningTradePlan|null;recommendation:ZeroDteRecommendation;strikeFlow:ZeroDteStrikeFlowRead|null;read:ZeroDteExecutionRead;sample:IfPremiumSample}):Promise<ZeroDteExecutionMemory>{return call({action:"sample",...args,openingPlan:args.openingPlan,flowState:args.read.edge==="upper"?args.strikeFlow?.callWall.state:args.read.edge==="lower"?args.strikeFlow?.putWall.state:"center"});}
export async function openIfPositionDb(args:{tradeDate:string;entryTime:string;entryCredit:number;contracts:number;side:string;read:ZeroDteExecutionRead}):Promise<ZeroDteExecutionMemory>{return call({action:"open",...args});}
export async function closeIfPositionDb(args:{tradeDate:string;exitTime:string;exitDebit:number;buybackScore:number;reason?:string}):Promise<ZeroDteExecutionMemory>{return call({action:"close",...args});}
