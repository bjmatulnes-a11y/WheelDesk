import type { ZeroDteChainRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteOpeningMap } from "./zeroDteOpeningMap";
import type { ZeroDteStrikeFlowRead } from "./zeroDteStrikeFlow";

export type ExecutionLifecycle = "WAIT" | "ARMED" | "SELL_READY" | "POSITION_OPEN" | "HOLD" | "BUYBACK_READY" | "COOLDOWN";
export type ExecutionScoreBreakdown = { priceStretch:number; premiumExpansion:number; dealerPressure:number; strikeFlow:number; pinAndTime:number };
export type IfPremiumSample = { timestamp:string; spot:number; credit:number; sellScore:number; buybackScore:number; springProbability:number; opportunityScore:number };
export type IfPositionMemory = { id:string; openedAt:string; entryCredit:number; quantity:number; entrySellScore:number; entrySpringProbability:number; entryOpportunityScore:number; side:"upper"|"lower"|"center" };
export type IfClosedTrade = IfPositionMemory & { closedAt:string; exitDebit:number; buybackScore:number; pnlDollars:number; durationMinutes:number };
export type ZeroDteExecutionMemory = { tradeDate:string; tradeDayId:string|null; samples:IfPremiumSample[]; position:IfPositionMemory|null; closedTrades:IfClosedTrade[]; cooldownUntil:string|null };
export type ZeroDteExecutionRead = {
 tradeDate:string; generatedAt:string; lifecycle:ExecutionLifecycle; currentCredit:number|null; openingCredit:number|null; peakCredit:number|null;
 premiumExpansionPct:number|null; premiumFromPeakPct:number|null; premiumVelocityPerMinute:number|null; sellScore:number; buybackScore:number;
 springProbability:number; opportunityScore:number; expectedMagnet:number; expectedMeanReversionPoints:number; edge:"upper"|"lower"|"center";
 peakDetected:boolean; sellBreakdown:ExecutionScoreBreakdown; sellReasons:string[]; buybackReasons:string[]; action:string;
 position:IfPositionMemory|null; closedTrades:IfClosedTrade[];
};
export const emptyExecutionMemory=(tradeDate:string):ZeroDteExecutionMemory=>({tradeDate,tradeDayId:null,samples:[],position:null,closedTrades:[],cooldownUntil:null});

export function calculateIronFlyCredit(rows:ZeroDteChainRow[], center:number, lowerWing:number, upperWing:number):number|null {
 const shortPut=optionMid(rows,center,"put"), shortCall=optionMid(rows,center,"call");
 const longPut=optionMid(rows,lowerWing,"put"), longCall=optionMid(rows,upperWing,"call");
 if([shortPut,shortCall,longPut,longCall].some(v=>v===null)) return null;
 return Math.max(0,Number(shortPut)+Number(shortCall)-Number(longPut)-Number(longCall));
}
function optionMid(rows:ZeroDteChainRow[],strike:number,type:"call"|"put"):number|null {
 const row=rows.find(x=>x.optionType===type&&Math.abs(x.strike-strike)<.01);
 if(!row)return null; if(Number.isFinite(row.mid))return Number(row.mid);
 if(Number.isFinite(row.bid)&&Number.isFinite(row.ask))return (Number(row.bid)+Number(row.ask))/2;
 if(Number.isFinite(row.last))return Number(row.last); return null;
}

export function buildZeroDteExecutionRead(args:{tradeDate:string;generatedAt:string;openingMap:ZeroDteOpeningMap;recommendation:ZeroDteRecommendation;spxRows:ZeroDteChainRow[];strikeFlow:ZeroDteStrikeFlowRead|null;memory:ZeroDteExecutionMemory}):ZeroDteExecutionRead {
 const {openingMap:map,recommendation:rec,memory,strikeFlow}=args;
 const currentCredit=calculateIronFlyCredit(args.spxRows,map.center,map.lowerWing,map.upperWing);
 const samples=memory.samples; const openingCredit=samples[0]?.credit??currentCredit;
 const peakCredit=samples.length?Math.max(...samples.map(s=>s.credit),currentCredit??0):currentCredit;
 const premiumExpansionPct=currentCredit!==null&&openingCredit?((currentCredit-openingCredit)/openingCredit)*100:null;
 const premiumFromPeakPct=currentCredit!==null&&peakCredit?((currentCredit-peakCredit)/peakCredit)*100:null;
 const prev=samples.at(-1)??null; const mins=prev?(Date.parse(args.generatedAt)-Date.parse(prev.timestamp))/60000:null;
 const velocity=currentCredit!==null&&prev&&mins&&mins>0?(currentCredit-prev.credit)/mins:null;
 const offset=rec.spxPrice-map.center; const edge=Math.abs(offset)<=10?"center":offset>0?"upper":"lower";
 const stretch=clamp01(Math.abs(offset)/50); const priceStretch=Math.round(25*curveStretch(stretch));
 const premiumExpansion=Math.round(25*clamp01((premiumExpansionPct??0)/25));
 const against=edge==="upper"?Math.max(0,rec.dealerPressure):edge==="lower"?Math.max(0,-rec.dealerPressure):Math.abs(rec.dealerPressure);
 const dealerPressure=Math.round(15*clamp01(1-against/65));
 const wallState=edge==="upper"?strikeFlow?.callWall.state:edge==="lower"?strikeFlow?.putWall.state:"quiet";
 let flow=7; if(edge==="upper"&&wallState==="defended")flow=15; if(edge==="upper"&&wallState==="attacked")flow=0;
 if(edge==="lower"&&wallState==="absorbed")flow=15; if(edge==="lower"&&wallState==="breaking")flow=0; if(edge==="center"&&strikeFlow?.hasPriorSnapshot)flow=10;
 const ny=getNyMinutes(args.generatedAt); const timeFactor=ny!==null&&ny<580?.15:ny!==null&&ny>=900?.35:1;
 const pin=Math.round(20*clamp01((rec.spx.symmetryScore+rec.confidenceScore)/180)*timeFactor);
 const sellBreakdown={priceStretch,premiumExpansion,dealerPressure,strikeFlow:flow,pinAndTime:pin};
 let sellScore=clamp(Object.values(sellBreakdown).reduce((a,b)=>a+b,0));
 const peakDetected=Boolean(currentCredit!==null&&peakCredit!==null&&samples.length>=2&&peakCredit-currentCredit>=.75&&(velocity??0)<0);
 if(peakDetected&&sellScore>=70)sellScore=clamp(sellScore+7);
 const springProbability=clamp(Math.round(stretch*42+dealerPressure/15*18+flow/15*22+clamp01(rec.spx.symmetryScore/100)*18));
 const riskEfficiency=currentCredit===null?0:clamp01(currentCredit/50); const opportunityScore=clamp(Math.round(sellScore*.58+springProbability*.27+riskEfficiency*100*.15));
 let buybackScore=0; const buyReasons:string[]=[];
 if(memory.position&&currentCredit!==null){const captured=clamp01((memory.position.entryCredit-currentCredit)/Math.max(memory.position.entryCredit,1)); const centerReturn=clamp01(1-Math.abs(offset)/50); const age=Math.max(0,(Date.parse(args.generatedAt)-Date.parse(memory.position.openedAt))/60000); buybackScore=clamp(Math.round(captured*58+centerReturn*27+clamp01(age/45)*15)); if(captured>.15)buyReasons.push("Meaningful premium has collapsed."); if(centerReturn>.7)buyReasons.push("SPX has returned toward the locked center."); if(buybackScore>=85)buyReasons.push("Buyback threshold reached.");}
 const cooldown=memory.cooldownUntil&&Date.parse(memory.cooldownUntil)>Date.parse(args.generatedAt);
 let lifecycle:ExecutionLifecycle="WAIT", action="WAIT — opening map is fixed; allow the execution score to build.";
 if(cooldown){lifecycle="COOLDOWN";action="COOLDOWN — require a fresh setup after the prior trade.";} else if(memory.position){lifecycle=buybackScore>=85?"BUYBACK_READY":"HOLD";action=buybackScore>=85?"BUYBACK READY — premium collapse and center return justify closing.":"HOLD — the exit engine has not completed the spring.";} else if(sellScore>=88&&springProbability>=75&&opportunityScore>=80){lifecycle="SELL_READY";action=peakDetected?"SELL WINDOW — premium/score rollover detected near the edge.":"SELL READY — execution stack is aligned.";} else if(sellScore>=68){lifecycle="ARMED";action="ARMED — monitor for premium peak, wall defense, or score rollover.";}
 const reasons=[`Price is ${Math.round(stretch*100)}% of the way from center to a 50-point wing.`,premiumExpansionPct===null?"Building the opening premium baseline.":`IF credit is ${premiumExpansionPct>=0?"+":""}${premiumExpansionPct.toFixed(1)}% versus the tracked open.`,`Dealer pressure contributes ${dealerPressure}/15.`,`Strike flow contributes ${flow}/15 (${wallState??"quiet"}).`,peakDetected?"Premium rollover detected after a tracked peak.":"Premium peak is still being tracked."];
 return {tradeDate:args.tradeDate,generatedAt:args.generatedAt,lifecycle,currentCredit,openingCredit,peakCredit,premiumExpansionPct,premiumFromPeakPct,premiumVelocityPerMinute:velocity,sellScore,buybackScore,springProbability,opportunityScore,expectedMagnet:map.center,expectedMeanReversionPoints:Math.round(Math.abs(offset)*springProbability/100),edge,peakDetected,sellBreakdown,sellReasons:reasons,buybackReasons:buyReasons,action,position:memory.position,closedTrades:memory.closedTrades};
}
export function sampleFromRead(read:ZeroDteExecutionRead,spot:number):IfPremiumSample|null{return read.currentCredit===null?null:{timestamp:read.generatedAt,spot,credit:read.currentCredit,sellScore:read.sellScore,buybackScore:read.buybackScore,springProbability:read.springProbability,opportunityScore:read.opportunityScore};}
const clamp=(n:number)=>Math.max(0,Math.min(100,Math.round(n))); const clamp01=(n:number)=>Math.max(0,Math.min(1,n));
function curveStretch(r:number){return r<=.55?r*.35:r<=1?.2+(r-.55)*1.75:Math.max(.35,1-(r-1)*1.5)}
function getNyMinutes(iso:string){try{const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date(iso));return Number(p.find(x=>x.type==="hour")?.value)*60+Number(p.find(x=>x.type==="minute")?.value)}catch{return null}}
