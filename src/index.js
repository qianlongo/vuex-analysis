import devtoolPlugin from './plugins/devtool'
import applyMixin from './mixin'
import { mapState, mapMutations, mapGetters, mapActions } from './helpers'
import { isObject, isPromise, assert } from './util'

let Vue // bind on install

class Store {
  constructor (options = {}) {
    // 需要先装载Vue
    assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
    // vuex依赖Promise
    assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)

    const {
      state = {},
      plugins = [],
      strict = false
    } = options

    // store internal state
    this._options = options
    // 和strict相对
    this._committing = false
    this._actions = Object.create(null)
    this._mutations = Object.create(null)
    // 主要作用是为getters服务
    this._wrappedGetters = Object.create(null)
    this._runtimeModules = Object.create(null)
    this._subscribers = []
    this._watcherVM = new Vue()

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this
    // 使dispatch内部的this指向当前的Store，下面的commit也是
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    // 在严格模式下，无论何时发生了状态变更且不是由 mutation 函数引起的，将会抛出错误。这能保证所有的状态变更都能被调试工具跟踪到。
    this.strict = strict

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    installModule(this, state, [], options)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    resetStoreVM(this, state)

    // apply plugins
    plugins.concat(devtoolPlugin).forEach(plugin => plugin(this))
  }
  // store.state  就是_vm.state
  get state () {
    return this._vm.state
  }
  // 不允许手动直接设置state
  set state (v) {
    assert(false, `Use store.replaceState() to explicit replace store state.`)
  }

  commit (type, payload, options) {
    // check object-style commit
    /**
     * store.commit('increment', {
     *    amount: 10
     *  })
     *  // 对象提交方式
     *  store.commit({
     *    type: 'increment',
     *    amount: 10
     *  })
     */
    if (isObject(type) && type.type) {
      options = payload
      payload = type
      type = type.type
    }
    const mutation = { type, payload }
    const entry = this._mutations[type]
    // 没有找到对应的type，进行报错
    if (!entry) {
      console.error(`[vuex] unknown mutation type: ${type}`)
      return
    }

    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })
    if (!options || !options.silent) {
      this._subscribers.forEach(sub => sub(mutation, this.state))
    }
  }

  dispatch (type, payload) {
    // check object-style dispatch
    // 参数处理
    if (isObject(type) && type.type) {
      payload = type
      type = type.type
    }
    const entry = this._actions[type]
    if (!entry) {
      console.error(`[vuex] unknown action type: ${type}`)
      return
    }
    // 当handler有多个时，用Promise.all进行包装一层,只有一个则直接调用
    return entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)
  }

  subscribe (fn) {
    const subs = this._subscribers
    if (subs.indexOf(fn) < 0) {
      subs.push(fn)
    }
    return () => {
      const i = subs.indexOf(fn)
      if (i > -1) {
        subs.splice(i, 1)
      }
    }
  }

  watch (getter, cb, options) {
    assert(typeof getter === 'function', `store.watch only accepts a function.`)
    return this._watcherVM.$watch(() => getter(this.state), cb, options)
  }

  replaceState (state) {
    this._withCommit(() => {
      this._vm.state = state
    })
  }

  registerModule (path, module) {
    if (typeof path === 'string') path = [path]
    assert(Array.isArray(path), `module path must be a string or an Array.`)
    this._runtimeModules[path.join('.')] = module
    installModule(this, this.state, path, module)
    // reset store to update getters...
    resetStoreVM(this, this.state)
  }

  unregisterModule (path) {
    if (typeof path === 'string') path = [path]
    assert(Array.isArray(path), `module path must be a string or an Array.`)
    delete this._runtimeModules[path.join('.')]
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this)
  }

  hotUpdate (newOptions) {
    updateModule(this._options, newOptions)
    resetStore(this)
  }

  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}

function updateModule (targetModule, newModule) {
  if (newModule.actions) {
    targetModule.actions = newModule.actions
  }
  if (newModule.mutations) {
    targetModule.mutations = newModule.mutations
  }
  if (newModule.getters) {
    targetModule.getters = newModule.getters
  }
  if (newModule.modules) {
    for (const key in newModule.modules) {
      if (!(targetModule.modules && targetModule.modules[key])) {
        console.warn(
          `[vuex] trying to add a new module '${key}' on hot reloading, ` +
          'manual reload is needed'
        )
        return
      }
      updateModule(targetModule.modules[key], newModule.modules[key])
    }
  }
}

function resetStore (store) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  const state = store.state
  // init root module
  installModule(store, state, [], store._options, true)
  // init all runtime modules
  Object.keys(store._runtimeModules).forEach(key => {
    installModule(store, state, key.split('.'), store._runtimeModules[key], true)
  })
  // reset vm
  resetStoreVM(store, state)
}

function resetStoreVM (store, state) {
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  // 对wrappedGetters进行get处理
  Object.keys(wrappedGetters).forEach(key => {
    const fn = wrappedGetters[key]
    // use computed to leverage its lazy-caching mechanism
    computed[key] = () => fn(store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key]
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  Vue.config.silent = true
  // 往store上添加了一个_vm属性，该属性是Vue的实例，并且用state作为其data
  store._vm = new Vue({
    data: { state },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  if (store.strict) {
    enableStrictMode(store)
  }

  if (oldVm) {
    // dispatch changes in all subscribed watchers
    // to force getter re-evaluation.
    store._withCommit(() => {
      oldVm.state = null
    })
    Vue.nextTick(() => oldVm.$destroy())
  }
}

function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length
  const {
    state,
    actions,
    mutations,
    getters,
    modules
  } = module

  // set state
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      Vue.set(parentState, moduleName, state || {})
    })
  }
  // 初始化mutations, 真正主要实现在registerMutation函数
  if (mutations) {
    Object.keys(mutations).forEach(key => {
      registerMutation(store, key, mutations[key], path)
    })
  }

  if (actions) {
    Object.keys(actions).forEach(key => {
      registerAction(store, key, actions[key], path)
    })
  }
  // 如果传递了getters，用wrapGetters进行初始化处理
  if (getters) {
    wrapGetters(store, getters, path)
  }

  if (modules) {
    Object.keys(modules).forEach(key => {
      installModule(store, rootState, path.concat(key), modules[key], hot)
    })
  }
}

function registerMutation (store, type, handler, path = []) {
  // 为什么同一个type需要是一个数组呢？ 而不是一个函数？，因为有模块的情况下mutation是有可能名字一样的，故用数组存
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler(getNestedState(store.state, path), payload)
  })
}

function registerAction (store, type, handler, path = []) {
  // 同commit, 如果store._actions有则读取，没有就设置为一个数组
  const entry = store._actions[type] || (store._actions[type] = [])
  // 读取store上的dispatch和commit函数,这里有点疑问的是，为什么getters不直接读取
  const { dispatch, commit } = store
  // 添加action
  entry.push(function wrappedActionHandler (payload, cb) {
    let res = handler({
      dispatch,
      commit,
      getters: store.getters,
      state: getNestedState(store.state, path),
      rootState: store.state
    }, payload, cb)
    // 如果action的回调handler返回的不是一个Promise则进行一层包装
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      // 返回Promise res
      return res
    }
  })
}

function wrapGetters (store, moduleGetters, modulePath) {
  /**
   * getters: {
   *   // ...
   *   doneTodosCount: (state, getters) => {
   *     return getters.doneTodos.length
   *   }
   * }
   */
  Object.keys(moduleGetters).forEach(getterKey => {    
    const rawGetter = moduleGetters[getterKey]
    // 不能重复设置getter
    if (store._wrappedGetters[getterKey]) {
      console.error(`[vuex] duplicate getter key: ${getterKey}`)
      return
    }
    // 往_wrappedGetters上添加函数,函数的store是computed时候传入的
    store._wrappedGetters[getterKey] = function wrappedGetter (store) {
      return rawGetter(
        getNestedState(store.state, modulePath), // local state
        store.getters, // getters
        store.state // root state
      )
    }
  })
}

function enableStrictMode (store) {
  store._vm.$watch('state', () => {
    assert(store._committing, `Do not mutate vuex store state outside mutation handlers.`)
  }, { deep: true, sync: true })
}

function getNestedState (state, path) {
  return path.length
    ? path.reduce((state, key) => state[key], state)
    : state
}

function install (_Vue) {
  // 防止重复装载
  if (Vue) {
    console.error(
      '[vuex] already installed. Vue.use(Vuex) should be called only once.'
    )
    return
  }
  Vue = _Vue
  applyMixin(Vue)
}

// auto install in dist mode
if (typeof window !== 'undefined' && window.Vue) {
  install(window.Vue)
}

export default {
  Store,
  install,
  mapState,
  mapMutations,
  mapGetters,
  mapActions
}
