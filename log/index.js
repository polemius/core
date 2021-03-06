let { createNanoEvents } = require('nanoevents')

class Log {
  constructor (opts = { }) {
    if (typeof opts.nodeId === 'undefined') {
      throw new Error('Expected node ID')
    }
    if (typeof opts.store !== 'object') {
      throw new Error('Expected store')
    }
    if (opts.nodeId.includes(' ')) {
      throw new Error('Space is prohibited in node ID')
    }

    this.nodeId = opts.nodeId

    this.lastTime = 0
    this.sequence = 0

    this.store = opts.store

    this.emitter = createNanoEvents()
  }

  on (event, listener) {
    return this.emitter.on(event, listener)
  }

  async add (action, meta = { }) {
    if (typeof action.type === 'undefined') {
      throw new Error('Expected "type" in action')
    }

    let newId = false
    if (typeof meta.id === 'undefined') {
      newId = true
      meta.id = this.generateId()
    }

    if (typeof meta.time === 'undefined') {
      meta.time = parseInt(meta.id)
    }

    if (typeof meta.reasons === 'undefined') {
      meta.reasons = []
    } else if (!Array.isArray(meta.reasons)) {
      meta.reasons = [meta.reasons]
    }

    for (let reason of meta.reasons) {
      if (typeof reason !== 'string') {
        throw new Error('Expected "reasons" to be strings')
      }
    }

    this.emitter.emit('preadd', action, meta)

    if (meta.keepLast) {
      this.removeReason(meta.keepLast, { olderThan: meta })
      meta.reasons.push(meta.keepLast)
    }

    if (meta.reasons.length === 0 && newId) {
      this.emitter.emit('add', action, meta)
      this.emitter.emit('clean', action, meta)
      return meta
    } else if (meta.reasons.length === 0) {
      let [action2] = await this.store.byId(meta.id)
      if (action2) {
        return false
      } else {
        this.emitter.emit('add', action, meta)
        this.emitter.emit('clean', action, meta)
        return meta
      }
    } else {
      let addedMeta = await this.store.add(action, meta)
      if (addedMeta === false) {
        return false
      } else {
        this.emitter.emit('add', action, addedMeta)
        return addedMeta
      }
    }
  }

  generateId () {
    let now = Date.now()
    if (now <= this.lastTime) {
      now = this.lastTime
      this.sequence += 1
    } else {
      this.lastTime = now
      this.sequence = 0
    }
    return now + ' ' + this.nodeId + ' ' + this.sequence
  }

  each (opts, callback) {
    if (!callback) {
      callback = opts
      opts = { order: 'created' }
    }

    let store = this.store
    return new Promise(resolve => {
      async function nextPage (get) {
        let page = await get()
        let result
        for (let i = page.entries.length - 1; i >= 0; i--) {
          let entry = page.entries[i]
          result = callback(entry[0], entry[1])
          if (result === false) break
        }

        if (result === false || !page.next) {
          resolve()
        } else {
          nextPage(page.next)
        }
      }

      nextPage(store.get.bind(store, opts))
    })
  }

  async changeMeta (id, diff) {
    for (let k in diff) {
      if (k === 'id' || k === 'added' || k === 'time' || k === 'subprotocol') {
        throw new Error('Meta "' + k + '" is read-only')
      }
    }

    if (diff.reasons && diff.reasons.length === 0) {
      let entry = await this.store.remove(id)
      if (entry) {
        for (let k in diff) entry[1][k] = diff[k]
        this.emitter.emit('clean', entry[0], entry[1])
      }
      return !!entry
    } else {
      return this.store.changeMeta(id, diff)
    }
  }

  removeReason (reason, criteria = { }) {
    return this.store.removeReason(reason, criteria, (action, meta) => {
      this.emitter.emit('clean', action, meta)
    })
  }

  byId (id) {
    return this.store.byId(id)
  }
}

module.exports = { Log }
