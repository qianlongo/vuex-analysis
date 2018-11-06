export default function (Vue) {
  // 获取Vue版本
  const version = Number(Vue.version.split('.')[0])
  // 版本大于2的时候，通过mixin的形式注入,钩子时期是beforeCreate
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
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
     * new Vue({
     *   el: '#root',
     *   router,
     *   store, 
     *   render: h => h(App)
     * })
     */
    // 将初始化Vue根组件时传入的store设置到this实例的$store上，子组件会从父组件上引用$store,层层嵌套进行设置
    const options = this.$options
    // store injection
    if (options.store) {
      // 上面简例中的store也可以是一个函数
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) {
      this.$store = options.parent.$store
    }
  }
}
