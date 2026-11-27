
import {disclosureAt} from './bond-disclosure.mjs';
import {pureBondDisclosure} from './bond-adaptive.mjs';
import {previousNavDate} from './nav-observation.mjs';

export const BOND_NAV_MEDIAN='bond-nav-median-v1';
const windowDays=15, validationDays=60;
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const mean=values=>values.reduce((sum,v)=>sum+v,0)/values.length;
const p90=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.9)-1];
const shortBond=name=>/中短债|短债|短期纯债/.test(name??'');

export function validateBondNavMedian(target,fit){
 const {samples,disclosure,name}=fit??{};
 if(!shortBond(name)||!pureBondDisclosure(disclosureAt(disclosure?[disclosure]:[],target))
   ||!(disclosure.categories.total>0)||!Array.isArray(samples)||samples.length!==windowDays+validationDays)return null;
 let expected=previousNavDate(target);
 for(const row of [...samples].reverse()){
  if(row?.date!==expected||!Number.isFinite(row.return))return null;
  expected=previousNavDate(expected);
 }
 const returns=samples.map(row=>row.return);
 const actual=returns.slice(windowDays);
 const errors=actual.map((value,i)=>Math.abs(median(returns.slice(i,i+windowDays))-value));
 const flatErrors=actual.map(Math.abs);
 const recent=errors.slice(-30),flatRecent=flatErrors.slice(-30);
 const mae=mean(errors),flatMae=mean(flatErrors),recentMae=mean(recent),flatRecentMae=mean(flatRecent);
 const tail=p90(errors),recentTail=p90(recent);
 const tolerance=1e-12;
 if(!(mae<flatMae*.95&&recentMae<flatRecentMae*.95&&recentMae<=.0003
   &&tail<=p90(flatErrors)+tolerance&&recentTail<=Math.min(.0005,p90(flatRecent))+tolerance
   &&Math.max(...errors)<=Math.max(...flatErrors)+tolerance))return null;
 return {return:median(returns.slice(-windowDays)),validation:{
  count:actual.length,from:samples[windowDays].date,to:samples.at(-1).date,mae,flatMae,recentMae,flatRecentMae,p90:tail,
 }};
}

export function fitBondNavMedian(target,{history,nav,holdings,name}){
 if(!shortBond(name))return null;
 const disclosure=disclosureAt(holdings?.disclosures,target);
 if(!pureBondDisclosure(disclosure)||!(disclosure.categories.total>0))return null;
 const byDate=new Map([...(history?.rows??[]),...(nav??[])].map(r=>[r.date,r]));
 const samples=[];
 for(let date=previousNavDate(target),i=0;i<windowDays+validationDays;i++,date=previousNavDate(date)){
  const row=byDate.get(date),previous=previousNavDate(date);
  if(!(row?.value>0)||!(byDate.get(previous)?.value>0)||row.adjustment||row.returnSource
   ||(row.previousDate&&row.previousDate!==previous)||!Number.isFinite(row.dailyReturn))return null;
  samples.push({date,return:row.dailyReturn});
 }
 const fit={name,disclosure,samples:samples.reverse()};
 const validated=validateBondNavMedian(target,fit);
 return validated?{...validated,fit:{...fit,validation:validated.validation}}:null;
}
