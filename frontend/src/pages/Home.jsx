import React from 'react'
import Navbar from '../components/Navbar';
import Hero from '../components/Hero';

const Home = () => {
  return (
    <div>
        <Navbar/>
        <main className="">
          <Hero />
        </main>
    </div>
  )
}

export default Home