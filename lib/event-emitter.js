class EventEmitter {
  constructor () {
    this.events = {}
  }

  addListener (evt, listener) {
    let listeners = this.events[ evt ] || (this.events[ evt ] = [])

    if (!listeners.includes(listener)) {
      listeners.push(listener)
    }
  }

  emit (evt, ...args) {
    let listeners = this.events[ evt ]

    listeners && listeners.forEach((listener) => {
      listener.apply(null, args)
    })
  }
}