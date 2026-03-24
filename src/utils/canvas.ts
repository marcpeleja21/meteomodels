/** Background canvas animation — rain & snow */

interface Particle {
  x: number
  y: number
  speed: number
  size: number
  opacity: number
  angle?: number
}

let animType: 'rain' | 'snow' | 'none' = 'none'
let rafId = 0
const particles: Particle[] = []

function initParticles(type: 'rain' | 'snow', canvas: HTMLCanvasElement) {
  particles.length = 0
  const count = type === 'rain' ? 120 : 80
  for (let i = 0; i < count; i++) {
    particles.push(makeParticle(type, canvas, true))
  }
}

function makeParticle(type: 'rain' | 'snow', canvas: HTMLCanvasElement, randomY = false): Particle {
  const p: Particle = {
    x:       Math.random() * canvas.width,
    y:       randomY ? Math.random() * canvas.height : -10,
    speed:   type === 'rain'
               ? 8 + Math.random() * 10
               : 0.8 + Math.random() * 1.4,
    size:    type === 'rain'
               ? 1 + Math.random() * 1.2
               : 2 + Math.random() * 3,
    opacity: type === 'rain'
               ? 0.3 + Math.random() * 0.4
               : 0.4 + Math.random() * 0.5,
    angle:   type === 'snow'
               ? Math.random() * Math.PI * 2
               : undefined,
  }
  return p
}

function drawRain(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#a0d8ef'
  for (const p of particles) {
    ctx.globalAlpha = p.opacity
    ctx.lineWidth = p.size
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x - 2, p.y + p.size * 10)
    ctx.stroke()
    p.y += p.speed
    p.x -= 0.5
    if (p.y > canvas.height) {
      Object.assign(p, makeParticle('rain', canvas, false))
    }
  }
  ctx.globalAlpha = 1
}

function drawSnow(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#ddeeff'
  for (const p of particles) {
    ctx.globalAlpha = p.opacity
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
    ctx.fill()
    p.y += p.speed
    p.x += Math.sin(p.angle! + p.y / 80) * 0.6
    p.angle! += 0.01
    if (p.y > canvas.height + 10) {
      Object.assign(p, makeParticle('snow', canvas, false))
    }
  }
  ctx.globalAlpha = 1
}

function loop(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  if (animType === 'rain') drawRain(ctx, canvas)
  else if (animType === 'snow') drawSnow(ctx, canvas)
  if (animType !== 'none') {
    rafId = requestAnimationFrame(() => loop(canvas, ctx))
  }
}

export function startAnimation(type: 'rain' | 'snow' | 'none') {
  const canvas = document.getElementById('bgCanvas') as HTMLCanvasElement | null
  if (!canvas) return
  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  cancelAnimationFrame(rafId)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  animType = type

  if (type !== 'none') {
    initParticles(type, canvas)
    loop(canvas, ctx)
  }
}

export function resizeCanvas() {
  const canvas = document.getElementById('bgCanvas') as HTMLCanvasElement | null
  if (canvas) {
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
  }
}
