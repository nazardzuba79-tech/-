import { Fragment, ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ChevronDown, CreditCard, Landmark, LogOut, Menu, UserRound, X } from 'lucide-react';
import { api, clearToken, getToken } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useAdminAlertSound } from '../lib/useAdminAlerts';
import { Logo } from './Logo';
import { LanguageSwitcher } from './LanguageSwitcher';
import { BottomNav } from './BottomNav';
import { DepositModal } from './DepositModal';
import { prefetchDepositConfig } from '../lib/useDepositOptions';
import { TopGainersTicker } from './TopGainersTicker';
import type { LiveQuote } from '../lib/liveMarketTypes';
import { prefetchCopyMarketplace } from '../lib/useCopyMarketplace';

export function Nav({active,middle,rightExtra,onTickerSelect,tickerHrefFor,hideTicker,staticTicker,tickerSymbols,tickerFitToWidth,futuresReference,quoteAsset}:{active:string;middle?:ReactNode;rightExtra?:ReactNode;onTickerSelect?:(pair:string)=>void;tickerHrefFor?:(pair:string)=>string;hideTicker?:boolean;staticTicker?:boolean;tickerSymbols?:string[];tickerFitToWidth?:boolean;futuresReference?:ReadonlyMap<string,LiveQuote>;quoteAsset?:string}) {
  const navigate=useNavigate(),location=useLocation(),{t}=useLanguage();
  const[mobileOpen,setMobileOpen]=useState(false),[isAdmin,setIsAdmin]=useState(false),[avatarUrl,setAvatarUrl]=useState<string|null>(null),[showDeposit,setShowDeposit]=useState(false),[tradeMenuOpen,setTradeMenuOpen]=useState(false),[profileMenuOpen,setProfileMenuOpen]=useState(false);
  const tradeMenuCloseTimer=useRef<number|null>(null),profileMenuRef=useRef<HTMLDivElement>(null);
  const LINKS=[
    {to:'/markets',label:t('nav.markets')},
    {to:'/trade',label:t('nav.trade')},
    {to:'/futures',label:t('nav.futures')},
    {to:'/trading-bots',label:'Торговые боты'},
    {to:'/banking',label:'Banking & Earn'},
    {to:'/wallet',label:t('nav.wallet')},
    {to:'/copy-trading',label:t('nav.copyTrading')},
    {to:'/arbitrage',label:t('nav.arbitrage')},
  ];
  /**
   * The wallet lives in the right-hand money cluster on desktop, next to the
   * deposit button — so it is filtered out of the left product sections and
   * rendered once, there. `LINKS` itself is untouched, which is what keeps
   * the wallet in the mobile menu: the same entry, the same route, the same
   * auth; only the desktop position changes.
   */
  const WALLET_LINK=LINKS.find(l=>l.to==='/wallet');
  const DESKTOP_LINKS=LINKS.filter(l=>l.to!=='/wallet');
  useEffect(()=>()=>{if(tradeMenuCloseTimer.current)window.clearTimeout(tradeMenuCloseTimer.current);},[]);
  useEffect(()=>setMobileOpen(false),[location.pathname]);
  useEffect(()=>{if(!getToken())return;api.getMe().then(me=>{setIsAdmin(me.isAdmin);setAvatarUrl(me.avatarUrl);}).catch(()=>{});},[]);
  useAdminAlertSound(isAdmin);
  useEffect(()=>{if(!profileMenuOpen)return;function handler(e:MouseEvent){if(profileMenuRef.current&&!profileMenuRef.current.contains(e.target as Node))setProfileMenuOpen(false);}document.addEventListener('mousedown',handler);return()=>document.removeEventListener('mousedown',handler);},[profileMenuOpen]);
  function handleLogout(){clearToken();navigate('/');}
  return <>
    <header className="global-header top-nav-bar">
      <div className="header-left">
        <button className="mobile-menu nav-burger" onClick={()=>setMobileOpen(v=>!v)} aria-label={t('nav.menu')} aria-expanded={mobileOpen}>{mobileOpen?<X size={18}/>:<Menu size={18}/>}</button>
        <Link to="/trade" className="header-brand" style={styles.logo}><Logo/></Link><span className="brand-separator top-nav-divider" aria-hidden="true"/>
        <nav className="main-nav nav-desktop-links" aria-label={t('nav.menu')}>
          {DESKTOP_LINKS.map(l=>l.to==='/trade'?<div key={l.to} className="nav-item-wrap" onFocus={()=>{if(tradeMenuCloseTimer.current)window.clearTimeout(tradeMenuCloseTimer.current);setTradeMenuOpen(true);}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setTradeMenuOpen(false);}} onKeyDown={e=>{if(e.key==='Escape')setTradeMenuOpen(false);}} onMouseEnter={()=>{if(tradeMenuCloseTimer.current)window.clearTimeout(tradeMenuCloseTimer.current);setTradeMenuOpen(true);}} onMouseLeave={()=>{tradeMenuCloseTimer.current=window.setTimeout(()=>setTradeMenuOpen(false),250);}}>
            <Link to={l.to} className={`nav-item top-nav-link${active===l.to?' nav-active is-active':''}`} aria-haspopup="menu" aria-expanded={tradeMenuOpen}>{l.label}<ChevronDown size={12} className={`nav-chevron${tradeMenuOpen?' nav-chevron-open':''}`}/></Link>
            {tradeMenuOpen&&<div className="nav-dropdown" role="menu"><Link to="/trade" style={styles.tradeMenuItem}><span style={styles.tradeMenuItemTitle}>{t('trade.spotTab')}</span><span style={styles.tradeMenuItemDesc}>{t('nav.tradeSpotDesc')}</span></Link><Link to="/trade?market=cfd" style={styles.tradeMenuItem}><span style={styles.tradeMenuItemTitle}>{t('trade.cfdTab')}</span><span style={styles.tradeMenuItemDesc}>{t('nav.tradeCfdDesc')}</span></Link></div>}
          </div>:<Link key={l.to} to={l.to} onMouseEnter={l.to==='/copy-trading'?prefetchCopyMarketplace:undefined} onPointerDown={l.to==='/copy-trading'?prefetchCopyMarketplace:undefined} onFocus={l.to==='/copy-trading'?prefetchCopyMarketplace:undefined} className={`nav-item top-nav-link${active===l.to?' nav-active is-active':''}`}>{l.label}</Link>)}
          <Link to="/card" className={`nav-item nav-secondary top-nav-link${active==='/card'?' nav-active is-active':''}`}><CreditCard size={14}/>{t('nav.card')}</Link>
          <Link to="/otc" className={`nav-item nav-secondary top-nav-link${active==='/otc'?' nav-active is-active':''}`}>{t('nav.otc')}</Link>
          {/* Админка is NOT a product section. It used to sit here, after
              OTC, reading as one more place to trade and getting lost
              between Crypto Card and the wallet. It now renders once, in
              the account cluster on the right, directly before «Кошелёк» —
              see the header-actions block below. */}
          {middle}
        </nav>
      </div>
      <div className="header-actions nav-desktop-right">
        {/* «Админка» is not in this row: it lives in the profile menu,
            between «Профиль» and «Выйти» (owner, 2026-09-24), admin-only on
            the same gate, and in the mobile drawer as before. */}
        {WALLET_LINK&&<Link to={WALLET_LINK.to} className={`nav-item top-nav-link nav-wallet-link${active===WALLET_LINK.to?' nav-active is-active':''}`}>{quoteAsset&&<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 10h18M7 15h2m3 0h1"/></svg>}{WALLET_LINK.label}</Link>}
        <button onClick={()=>setShowDeposit(true)} onPointerEnter={prefetchDepositConfig} onFocus={prefetchDepositConfig} className="deposit-button top-nav-fund-btn"><span>{t('wallet.deposit')}</span></button>
        {rightExtra&&<div className="header-extra-action">{rightExtra}</div>}<LanguageSwitcher variant="pill" quoteAsset={quoteAsset}/>
        <div className="top-nav-profile-wrap" ref={profileMenuRef}><button type="button" className="header-icon profile-control top-nav-profile-btn" onClick={()=>setProfileMenuOpen(o=>!o)} aria-expanded={profileMenuOpen}><span className="top-nav-profile-avatar">{avatarUrl?<img src={avatarUrl} alt=""/>:<UserRound size={13}/>}</span><span>{t('nav.profile')}</span><ChevronDown size={11} className={`nav-chevron${profileMenuOpen?' nav-chevron-open':''}`}/></button>{profileMenuOpen&&<div className="top-nav-profile-menu"><Link to="/settings" onClick={()=>setProfileMenuOpen(false)}><UserRound size={14}/>{t('nav.profile')}</Link>{isAdmin&&<Link to="/admin" className="top-nav-profile-admin" onClick={()=>setProfileMenuOpen(false)}><Landmark size={14}/>{t('nav.admin')}</Link>}<button type="button" onClick={handleLogout}><LogOut size={14}/>{t('nav.logout')}</button></div>}</div>
      </div>
      <div className={`nav-mobile-menu${mobileOpen?' open':''}`}>
        <button className="deposit-button" onPointerDown={prefetchDepositConfig} onClick={()=>{setShowDeposit(true);setMobileOpen(false);}} style={{justifyContent:'center',marginBottom:4}}>{t('wallet.deposit')}</button>
        {LINKS.map(l=><Fragment key={l.to}><Link to={l.to} onMouseEnter={l.to==='/copy-trading'?prefetchCopyMarketplace:undefined} onFocus={l.to==='/copy-trading'?prefetchCopyMarketplace:undefined} onPointerDown={l.to==='/copy-trading'?prefetchCopyMarketplace:undefined} style={{...styles.mobileLink,...(active===l.to?styles.linkActive:{})}}>{l.label}</Link>{l.to==='/trade'&&<Link to="/trade?market=cfd" style={{...styles.mobileLink,paddingLeft:20,fontSize:13}}>{t('trade.cfdTab')}</Link>}</Fragment>)}
        <Link to="/card" style={{...styles.mobileLink,...styles.cardLink,...(active==='/card'?styles.linkActive:{})}}><CreditCard size={14}/>{t('nav.card')}</Link>
        <Link to="/otc" style={{...styles.mobileLink,...(active==='/otc'?styles.linkActive:{})}}>{t('nav.otc')}</Link>
        {isAdmin&&<Link to="/admin" style={{...styles.mobileLink,...styles.adminBadge,...(active==='/admin'?styles.adminBadgeActive:{})}}><Landmark size={14}/>{t('nav.admin')}</Link>}
        <div style={styles.mobileDivider}/><Link to="/settings" style={{...styles.mobileLink,...styles.cardLink,...(active==='/settings'?styles.linkActive:{})}}><UserRound size={15}/>{t('nav.profile')}</Link>
        {rightExtra&&<div style={styles.mobileRightExtra}>{rightExtra}</div>}<div style={styles.mobileLangRow}><LanguageSwitcher/></div><button onClick={handleLogout} style={{...styles.logoutBtn,width:'100%'}}><LogOut size={14}/>{t('nav.logout')}</button>
      </div>
    </header>
    {!hideTicker&&<TopGainersTicker onSelect={onTickerSelect} hrefFor={tickerHrefFor} staticStrip={staticTicker} symbols={tickerSymbols} fitToWidth={tickerFitToWidth} futuresReference={futuresReference}/>} {showDeposit&&<DepositModal onClose={()=>setShowDeposit(false)}/>}<BottomNav/>
  </>;
}

const styles:Record<string,React.CSSProperties>={
  logo:{display:'inline-flex',alignItems:'center',fontFamily:'var(--font-display)',fontSize:16,fontWeight:800,letterSpacing:'0.02em'},
  tradeMenuItem:{display:'flex',flexDirection:'column',gap:2,padding:'7px 8px',borderRadius:5},tradeMenuItemTitle:{fontSize:13,fontWeight:600,color:'#e8ecf3'},tradeMenuItemDesc:{fontSize:12,color:'var(--h-text-3)'},
  mobileLink:{display:'flex',alignItems:'center',fontSize:13.5,fontWeight:500,color:'#d8dce6',padding:'11px 12px',borderRadius:6},mobileDivider:{height:1,background:'var(--border)',margin:'4px 0'},mobileRightExtra:{padding:'8px 0'},mobileLangRow:{padding:'10px 6px'},linkActive:{color:'#ffffff',background:'rgba(240,196,63,0.06)'},cardLink:{display:'flex',alignItems:'center',gap:8},adminBadge:{display:'flex',alignItems:'center',gap:8,background:'linear-gradient(180deg,#22203a,#1a1930)',border:'1px solid #3a3868',borderRadius:6,padding:'11px 12px',fontSize:13.5,fontWeight:500,color:'#c3c1ff'},adminBadgeActive:{background:'linear-gradient(180deg,#2b2849,#201e3b)',borderColor:'#4b4886',color:'#dcdbff'},logoutBtn:{display:'flex',alignItems:'center',justifyContent:'center',gap:7,background:'transparent',border:'1px solid var(--border)',color:'var(--text-secondary)',borderRadius:8,padding:'8px 16px',fontSize:12},
};
