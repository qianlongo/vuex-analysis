/* 从window对象的__VUE_DEVTOOLS_GLOBAL_HOOK__中获取devtool插件 */
const devtoolHook =
  typeof window !== 'undefined' &&
  window.__VUE_DEVTOOLS_GLOBAL_HOOK__

export default function devtoolPlugin (store) {
  if (!devtoolHook) return
   /* devtoll插件实例存储在store的_devtoolHook上 */
  store._devtoolHook = devtoolHook

  devtoolHook.emit('vuex:init', store)

  devtoolHook.on('vuex:travel-to-state', targetState => {
    store.replaceState(targetState)
  })
  /* 订阅store的变化 */
  store.subscribe((mutation, state) => {
    devtoolHook.emit('vuex:mutation', mutation, state)
  })
}
