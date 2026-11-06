import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import NewLivePage from '../../app/live/new/page';
import {LiveSessionView} from '../../components/LiveSessionView';
function Fixture(){const [route,setRoute]=useState(window.location.pathname);useEffect(()=>{const change=()=>setRoute(window.location.pathname);window.addEventListener('fixture-route',change);return()=>window.removeEventListener('fixture-route',change);},[]);return <main style={{padding:16}}>{route==='/live/22222222-2222-4222-8222-222222222222'?<LiveSessionView id="22222222-2222-4222-8222-222222222222"/>:<NewLivePage/>}</main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
