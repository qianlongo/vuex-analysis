export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])

  if (version >= 2) {
    const usesInit = Vue.config._lifecycleHooks.indexOf('init') > -1
    Vue.mixin(usesInit ? { init: vuexInit } : { beforeCreate: vuexInit })
  } else {
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    // 针对1.x版本进行兼容处理,方式是重写Vue的init方法
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   */

  function vuexInit () {
    /**
     * Vue.use(Vuex)
     * 
     * new Vue({
     *   el: '#root',
     *   router,
     *   store, 
     *   render: h => h(App)
     * })
     */
    const options = this.$options
    // store injection
    if (options.store) {
      // 根组件直接是读取传入的store
      // store也可以是函数
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
        // 子组件从父组件上获取store
    } else if (options.parent && options.parent.$store) {
      this.$store = options.parent.$store
    }
  }
}
