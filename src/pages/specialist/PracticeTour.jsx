import React,{useEffect,useState} from "react";
import {TOUR_STEPS} from "../../../lib/my-practice/onboarding-tour.js";
import "./PracticeTour.css";

// Non-modal spotlight: underlying forms remain clickable.
export default function PracticeTour({step,ready,onNext,onSkip,onClose}){
  const item=TOUR_STEPS[step];
  const [position,setPosition]=useState(null);
  useEffect(()=>{
    let frame=0;
    const measure=()=>{
      const el=document.querySelector(item.target);
      if(!el){setPosition(null);return;}
      const r=el.getBoundingClientRect();
      setPosition({top:Math.max(0,r.top-7),left:Math.max(0,r.left-7),width:r.width+14,height:r.height+14,
        popTop:r.bottom+16+245<window.innerHeight?r.bottom+16:Math.max(12,r.top-265),
        popLeft:Math.min(Math.max(12,r.left),Math.max(12,window.innerWidth-366))});
    };
    const el=document.querySelector(item.target);
    el?.scrollIntoView({behavior:"smooth",block:"center"});
    const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    update();window.addEventListener("resize",update);window.addEventListener("scroll",update,true);
    const timeout=setTimeout(update,400);
    const onKey=e=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",onKey);
    return ()=>{clearTimeout(timeout);cancelAnimationFrame(frame);window.removeEventListener("resize",update);window.removeEventListener("scroll",update,true);document.removeEventListener("keydown",onKey);};
  },[step,item.target,onClose]);
  return <>
    {position&&<div className="mp-tour-spotlight" aria-hidden="true" style={{top:position.top,left:position.left,width:position.width,height:position.height}}/>}
    <aside className="mp-tour-popover" role="dialog" aria-modal="false" aria-label="Обучение по кабинету"
      style={position?{top:position.popTop,left:position.popLeft}:undefined} data-testid="mp-tour-dialog">
      <div className="mp-tour-top"><span>Экскурсия · шаг {step+1} из {TOUR_STEPS.length}</span>
        <button type="button" onClick={onClose} aria-label="Закрыть обучение">×</button></div>
      <h3>{item.title}</h3><p>{item.description}</p>
      <p className="mp-tour-status" role="status">{ready?"Шаг выполнен. Можно продолжить.":"Выполните действие и сохраните изменения либо пропустите этот шаг."}</p>
      <div className="mp-tour-actions">
        <button type="button" className="mp-secondary" onClick={onSkip}>Пропустить шаг</button>
        <button type="button" className="mp-primary" onClick={onNext} disabled={!ready} data-testid="mp-tour-next">{step===TOUR_STEPS.length-1?"Завершить":"Далее"}</button>
      </div>
    </aside>
  </>;
}
