import {session,expectedCloseDate} from './calendar.mjs';
import {validDate} from './model.mjs';

// A closure changes the observation shown on the homepage, not NAV income dates.
// Any actually published NAV takes precedence over assumptions about publication.
export function bondObservation(today,latestDate){
 const market=session(today,'CN');
 if(!market.closed)return {date:today,closure:null};
 const published=validDate(latestDate)&&latestDate<=today?latestDate:null;
 return {date:published??expectedCloseDate(today,'CN'),closure:{today,reason:market.reason,publishedDate:published}};
}
