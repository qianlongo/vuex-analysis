import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert } from './util'
// 局部变量，用于判断是否已经装载过vuex 即是否使用过vue.use(vuex)
let Vue // bind on install

export class Store {
  constructor (options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731
    // 如果用户在实例化Store前没有主动Vue.use(Vuex)，这里会主动装载
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    if (process.env.NODE_ENV !== 'production') {
      // 创建store实例之前必须先装载Vuex
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      // 必须支持Promise
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      // 必须使用new操作符去创建Store
      assert(this instanceof Store, `Store must be called with the new operator.`)
    }

    const {
      // 插件集合，接受store作为唯一参数，可以监听mutation（这个地方可以用于数据持久化、提交mutation）
      plugins = [],
      strict = false
    } = options

    let {
      state = {}
    } = options
    // state属性可以是一个函数，内部执行该函数获取返回值，若无返回值则默认为空对象
    if (typeof state === 'function') {
      state = state() || {}
    }

    // store internal state
    // 是否正在提交的标志， 作用是使得状态的修改只能在mutation的回调函数中执行，在外部不行
    this._committing = false
    // actions操作对象,存放用户定义的所有action
    this._actions = Object.create(null)
    // 
    this._actionSubscribers = []
    // mutations操作对象
    this._mutations = Object.create(null)
    // 封装过后的getters对象
    this._wrappedGetters = Object.create(null)
    // 存储分析之后的模块树
    this._modules = new ModuleCollection(options)
    // 模块命名空间map
    this._modulesNamespaceMap = Object.create(null)
    // 订阅函数
    this._subscribers = []
    // 用于监测数据变化
    this._watcherVM = new Vue()

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this
    // 封装替换原型中的dispatch和commit函数，将其内部的this指向为store
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    this.strict = strict

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    /**
     * 给module添加上namespace、注册mutation、action、getters
     */
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    // 通过vm重新设置store，实现state computed等的响应化
    resetStoreVM(this, state)

    // apply plugins
    // 执行plugins, 并传入当前的store实例
    plugins.forEach(plugin => plugin(this))
    // devtool 插件
    if (Vue.config.devtools) {
      devtoolPlugin(this)
    }
  }

  get state () {
    // 初始化vuex时，传入的state便是实例化vue时候的data
    return this._vm._data.$$state
  }

  set state (v) {
    // 不允许直接修改state，非生产环境会报错
    if (process.env.NODE_ENV !== 'production') {
      assert(false, `Use store.replaceState() to explicit replace store state.`)
    }
  }

  commit (_type, _payload, _options) {
    // check object-style commit
    /**
     * store.commit('increment', {
     * amount: 10
     * })
     * store.commit({
     *   type: 'increment',
     *   amount: 10
     * })
     * 
     */
    // 适配参数
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = { type, payload }
    const entry = this._mutations[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    // 只能通过_withCommit方法修改状态
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })
    // 执行插件函数
    this._subscribers.forEach(sub => sub(mutation, this.state))

    if (
      process.env.NODE_ENV !== 'production' &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  dispatch (_type, _payload) {
    // check object-style dispatch
    /**
     * // 以载荷形式分发
     * store.dispatch('incrementAsync', {
     *   amount: 10
     * })
     * 
     * // 以对象形式分发
     * store.dispatch({
     *   type: 'incrementAsync',
     *   amount: 10
     * })
     * 
     */
    // 适配 dispatch函数参数
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    // 获取type类型的action集合,是一个数组
    const entry = this._actions[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }
    // 看subscribeAction函数，可以单独对action进行监听
    this._actionSubscribers.forEach(sub => sub(action, this.state))
    // 当entry是多个项时，用Promise.all去包一层，否则直接执行handler
    return entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)
  }
  // 添加监听mutation插件, 其实就是给_subscribers数组中不重复添加一个个函数
  subscribe (fn) {
    return genericSubscribe(fn, this._subscribers)
  }
  // 添加监听action的插件
  subscribeAction (fn) {
    return genericSubscribe(fn, this._actionSubscribers)
  }

  watch (getter, cb, options) {
    if (process.env.NODE_ENV !== 'production') {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }

  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }
  // 注册一个动态的module
  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    this._modules.register(path, rawModule)
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // reset store to update getters...
    resetStoreVM(this, this.state)
  }

  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path)
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this)
  }

  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  _withCommit (fn) {
    // 先保存先前的状态
    const committing = this._committing
    // 设置为true，不然直接修改会跑出错误
    this._committing = true
    // 执行定义时的mutation函数
    fn()
    // 修改state完毕，还原之前的状态
    this._committing = committing
  }
}

function genericSubscribe (fn, subs) {
  if (subs.indexOf(fn) < 0) {
    subs.push(fn)
  }
  // 返回用于取消刚才的监听函数的函数
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

function resetStoreVM (store, state, hot) {
  // 保存旧的vm实例
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    computed[key] = () => fn(store)
    // 代理一层getter
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  // https://cn.vuejs.org/v2/api/ 取消 Vue 所有的日志与警告。
  const silent = Vue.config.silent 
  Vue.config.silent = true
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  if (store.strict) {
    enableStrictMode(store)
  }

  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}
/**
 * 
 * @param {*} store Store的实例
 * @param {*} rootState 根state
 * @param {*} path 当前嵌套模块的路径数组
 * @param {*} module 当前安装的模块
 * @param {*} hot 动态改变modules或者热更新时为true
 */
function installModule (store, rootState, path, module, hot) {
  // 判断是否是跟路径
  const isRoot = !path.length
  // 获取命名空间
  // options
  /*
    {
      modules: {
        a: {
          modules: {
            b: {
              // ...
            }
          }
        }
      }
    }
    // [] path
    / 命名空间

    // [a] path
    /a/ 命名空间

    // [a, b] path
    /a/b/ 命名空间
  */
  const namespace = store._modules.getNamespace(path)
  // 存储有命名空间的模块
  // register in namespace map
  if (module.namespaced) {
    store._modulesNamespaceMap[namespace] = module
  }

  // set state
  if (!isRoot && !hot) {
    // 获取当前模块的父模块state
    const parentState = getNestedState(rootState, path.slice(0, -1))
    // 当前的模块名字
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      // https://cn.vuejs.org/v2/api/#Vue-set
      // 向响应式对象中添加一个属性，并确保这个新属性同样是响应式的，且触发视图更新。它必须用于向响应式对象上添加新属性，因为 Vue 无法探测普通的新增属性 (比如 this.myObject.newProperty = 'hi')
      Vue.set(parentState, moduleName, module.state)
    })
  }
  // 设置局部的module上下文
  const local = module.context = makeLocalContext(store, namespace, path)
  // 注册mutation，以供修改state
  module.forEachMutation((mutation, key) => {
    // 这里的key增加了命名空间
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })
  // 注册对应模块的action
  module.forEachAction((action, key) => {
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  const local = {
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

function makeLocalGetters (store, namespace) {
  const gettersProxy = {}

  const splitPos = namespace.length
  Object.keys(store.getters).forEach(type => {
    // skip if the target getter is not match this namespace
    if (type.slice(0, splitPos) !== namespace) return

    // extract local getter type
    const localType = type.slice(splitPos)

    // Add a port to the getters proxy.
    // Define as getter property because
    // we do not want to evaluate the getters in this time.
    Object.defineProperty(gettersProxy, localType, {
      get: () => store.getters[type],
      enumerable: true
    })
  })

  return gettersProxy
}
// 注册mutation
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  // 真正commit(type, payload)的时候执行的不是直接定义的mutation，而是这里的wrappedMutationHandler
  entry.push(function wrappedMutationHandler (payload) {
    // 接受的是local.state
    handler.call(store, local.state, payload)
  })
}

function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload, cb) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload, cb)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (process.env.NODE_ENV !== 'production') {
      assert(store._committing, `Do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}

function getNestedState (state, path) {
  return path.length
    ? path.reduce((state, key) => state[key], state)
    : state
}
/* 配置参数处理， 主要是第一个参数既可以是字符串type  也可以是对象类型
  store.commit('increment', {
    amount: 10
  })
  store.commit({
    type: 'increment',
    amount: 10
  })
*/
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (process.env.NODE_ENV !== 'production') {
    assert(typeof type === 'string', `Expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}
// 装载vuex的插件方法 https://cn.vuejs.org/v2/guide/plugins.html#%E5%BC%80%E5%8F%91%E6%8F%92%E4%BB%B6
export function install (_Vue) {
  // 重复装载判断
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue
  // 装载vuex真正执行的方法
  applyMixin(Vue)
}
