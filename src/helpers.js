
/*
// 在单独构建的版本中辅助函数为 Vuex.mapState
import { mapState } from 'vuex'

export default {
  // ...
  computed: mapState({
    // 箭头函数可使代码更简练
    count: state => state.count,

    // 传字符串参数 'count' 等同于 `state => state.count`
    countAlias: 'count',

    // 为了能够使用 `this` 获取局部状态，必须使用常规函数
    countPlusLocalState (state) {
      return state.count + this.localCount
    }
  })
}

computed: mapState([
  // 映射 this.count 为 store.state.count
  'count'
])
*/

export function mapState (states) {
  const res = {}
  normalizeMap(states).forEach(({ key, val }) => {
    res[key] = function mappedState () {
      /**
       * 如果是函数，则通过.call形式调用，并且函数的第一个参数是$store.state, 第二个参数是$store.getters
       * 不是函数就直接读取this.$store.state的值
       */
      return typeof val === 'function'
        ? val.call(this, this.$store.state, this.$store.getters)
        : this.$store.state[val]
    }
  })
  return res
}
// 使用 mapMutations 辅助函数将组件中的 methods 映射为 store.commit 调用（需要在根节点注入 store）
export function mapMutations (mutations) {
  const res = {}
  normalizeMap(mutations).forEach(({ key, val }) => {
    res[key] = function mappedMutation (...args) {
      return this.$store.commit.apply(this.$store, [val].concat(args))
    }
  })
  return res
}

// mapGetters 辅助函数仅仅是将 store 中的 getter 映射到局部计算属性
// 同样一开始需要getters参数进行格式化处理
export function mapGetters (getters) {
  const res = {}
  normalizeMap(getters).forEach(({ key, val }) => {
    res[key] = function mappedGetter () {
      // 注意这里为什么是val不是key in this.$store.getters呢，看下面的例子
      // 因为key有可能是要被改写的，真正读取的$store.getters还是val
      /*
        computed: {
        // 使用对象展开运算符将 getter 混入 computed 对象中
          ...mapGetters([
            'doneTodosCount',
            'anotherGetter',
            // ...
          ])
        }
        mapGetters({
          // 把 `this.doneCount` 映射为 `this.$store.getters.doneTodosCount`
          doneCount: 'doneTodosCount'
        })
      */
      if (!(val in this.$store.getters)) {
        console.error(`[vuex] unknown getter: ${val}`)
      }
      return this.$store.getters[val]
    }
  })
  return res
}

export function mapActions (actions) {
  const res = {}
  normalizeMap(actions).forEach(({ key, val }) => {
    res[key] = function mappedAction (...args) {
      return this.$store.dispatch.apply(this.$store, [val].concat(args))
    }
  })
  return res
}
// mapState mapAction等都有两种传参方式 数组或者对象，该方法主要是格式化参数,使外部使用统一
/* 以数组的方式传入
mapState([
  'count',
  'add'
])
=>
[
  {
    key: 'count',
    val: 'count'
  },
  {
    key: 'add',
    val: 'add'
  }
]

// 以对象的方法传入
mapState({
  count: state => state.count,
  countAlias: 'count'
})
=>
[
  {
    key: 'count',
    val: state => state.count
  },
  {
    key: 'countAlias',
    val: 'count'
  }
]
*/
function normalizeMap (map) {
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key }))
    : Object.keys(map).map(key => ({ key, val: map[key] }))
}
