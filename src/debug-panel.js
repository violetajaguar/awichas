// ?debug=1 tuning panel: edit the animal's placement live and copy the values into src/animals.js
export function mountDebugPanel(animal, onChange, extra = {}) {
  const panel = document.createElement('div')
  panel.id = 'debug'
  const field = (label, get, set, step = 0.01) => {
    const row = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'number'
    input.step = step
    input.value = get()
    input.addEventListener('input', () => { set(parseFloat(input.value) || 0); onChange(); dump() })
    row.append(label, input)
    panel.append(row)
  }
  const vec = (label, arr, step) => arr.forEach((_, i) => field(`${label}[${'xyz'[i]}]`, () => arr[i], v => { arr[i] = v }, step))
  panel.append(Object.assign(document.createElement('h4'), {textContent: 'On the portrait'}))
  field('size', () => animal.onTarget.size, v => { animal.onTarget.size = v }, 0.05)
  vec('position', animal.onTarget.position, 0.01)
  vec('rotation', animal.onTarget.rotation, 5)
  field('spin', () => animal.onTarget.spin || 0, v => { animal.onTarget.spin = v }, 5)
  panel.append(Object.assign(document.createElement('h4'), {textContent: 'On the hand'}))
  field('size (m)', () => animal.onHand.size, v => { animal.onHand.size = v }, 0.01)
  vec('rotation', animal.onHand.rotation, 5)
  const info = document.createElement('div')
  info.className = 'info'
  const out = document.createElement('pre')
  const dump = () => {
    out.textContent = JSON.stringify({onTarget: animal.onTarget, onHand: animal.onHand}, null, 1)
  }
  panel.append(info, out)
  dump()
  document.body.append(panel)
  return {
    setInfo: text => { info.textContent = text },
    destroy: () => panel.remove(),
  }
}
