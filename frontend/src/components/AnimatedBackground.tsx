import type React from "react";

/**
 * AnimatedBackground — Direct port of the Windows logon OOBE setup background animation.
 * Optimized to use GPU-accelerated transforms (translate + scale) for buttery-smooth
 * 60fps performance and guaranteed compatibility across all modern browsers.
 */
export const AnimatedBackground: React.FC = () => (
  <div className="oobe-bg" aria-hidden="true">
    <div className="circles">
      <div className="circle1" />
      <div className="circle2" />
      <div className="circle3" />
    </div>
    <style>{`
      .oobe-bg {
        position: fixed;
        inset: 0;
        z-index: 0;
        overflow: hidden;
        pointer-events: none;
        background-color: #030814;
        animation: oobeColorCycle 24s ease-in-out infinite alternate;
      }
      .circles {
        position: absolute;
        inset: 0;
        filter: blur(60px);
        will-change: transform;
      }
      .circle1, .circle2, .circle3 {
        position: absolute;
        border-radius: 50%;
        mix-blend-mode: screen;
        will-change: transform;
      }
      .circle1 {
        left: 30vw;
        top: 25vh;
        width: 30vw;
        height: 30vw;
        background: radial-gradient(50% 50% at 50% 50%, rgba(12, 119, 255, 0.35) 0%, rgba(12, 119, 255, 0) 100%);
        animation: circle1Transform 12s ease-in-out infinite alternate;
      }
      .circle2 {
        left: 45vw;
        top: 30vh;
        width: 20vw;
        height: 20vw;
        background: radial-gradient(50% 50% at 50% 50%, rgba(0, 56, 255, 0.35) 0%, rgba(0, 56, 255, 0) 100%);
        animation: circle2Transform 11.5s ease-in-out infinite alternate;
      }
      .circle3 {
        left: 35vw;
        top: 30vh;
        width: 20vw;
        height: 20vw;
        background: radial-gradient(50% 50% at 50% 50%, rgba(65, 56, 210, 0.55) 0%, rgba(65, 56, 210, 0) 100%);
        animation: circle3Transform 15s ease-in-out infinite alternate;
      }
      @keyframes circle1Transform {
        0% {
          transform: translate(0, 0) scale(1);
        }
        100% {
          transform: translate(5vw, -35vh) scale(2.6);
        }
      }
      @keyframes circle2Transform {
        0% {
          transform: translate(0, 0) scale(1);
        }
        100% {
          transform: translate(-45vw, -40vh) scale(4);
        }
      }
      @keyframes oobeColorCycle {
        0% { background-color: #030814; }
        33% { background-color: #0b071e; }
        66% { background-color: #0e0517; }
        100% { background-color: #020b17; }
      }
      @keyframes circle3Transform {
        0% {
          transform: translate(0, 0) scale(1);
        }
        100% {
          transform: translate(-55vw, -50vh) scale(6);
        }
      }
    `}</style>
  </div>
);
