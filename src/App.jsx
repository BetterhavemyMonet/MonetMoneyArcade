import { useState } from 'react'

export default function App() {
  const [name, setName] = useState(localStorage.getItem('player-name') || '')

  if (!name) {
    return (
      <div style={{
        height:'100vh',
        display:'flex',
        flexDirection:'column',
        justifyContent:'center',
        alignItems:'center',
        background:'#111',
        color:'white',
        gap:'12px'
      }}>
        <h1>Monet Money Arcade</h1>
        <input
          placeholder="Enter Player Name"
          onChange={(e)=>setName(e.target.value)}
          style={{padding:'12px',fontSize:'18px'}}
        />
        <button
          onClick={()=>{
            localStorage.setItem('player-name',name)
            window.location.reload()
          }}
          style={{padding:'12px 24px'}}
        >
          Enter Arcade
        </button>
      </div>
    )
  }

  return (
    <div style={{
      height:'100vh',
      background:'#111',
      color:'lime',
      display:'flex',
      justifyContent:'center',
      alignItems:'center',
      fontSize:'32px'
    }}>
      Welcome to Monet Money Arcade, {name} 🎮
    </div>
  )
}
