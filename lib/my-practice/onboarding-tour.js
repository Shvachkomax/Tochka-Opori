// A3.6: Safe client-only tour metadata. It never submits medical or financial information.
export const TOUR_STEPS = Object.freeze([
  {id:"places",title:"Добавьте место работы",description:"В разделе «Места работы» укажите место приёма. Адрес помогает организовать приём, но не заменяет подтверждённое членство в клинике.",target:'[data-tour-target="places"]',tab:"places"},
  {id:"services",title:"Создайте услугу",description:"В разделе «Услуги и цены» задайте название, цену, формат, длительность и направления Support и Health. Публикация доступна только после явного включения.",target:'[data-tour-target="services"]',tab:"services"},
  {id:"calendar",title:"Настройте расписание",description:"В календаре настройте серверные рабочие часы, выходные и исключения. Он показывает подтверждённые записи по разрешённым направлениям без объединения медицинских карт.",target:'[data-tour-target="calendar"]',tab:"calendar"},
]);
export const tourStorageKey = scope => "my-practice-tour-v1:"+String(scope||"public-demo");
export function tourStepReady(step,{places=0,offers=0,events=0,dirty=false,scheduleDirty=false}={}){
  if(step===0)return places>0&&!dirty;
  if(step===1)return offers>0&&!dirty;
  if(step===2)return events>0&&!scheduleDirty;
  return false;
}

export const TOUR_INVITE_DELAY_MS = 1600;
export const TOUR_INVITE_PULSE_MS = 10000;
export const tourInviteDismissKey = scope => "my-practice-tour-invite-v1:"+String(scope||"public-demo");
export function shouldInviteToPracticeTour({dismissed=false,places=0,offers=0,events=0,standalone=false}={}){
  return !standalone && !dismissed && places===0 && offers===0 && events===0;
}
