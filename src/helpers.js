
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
      return typeof val === 'function'
        ? val.call(this, this.$store.state, this.$store.getters)
        : this.$store.state[val]
    }
  })
  return res
}

export function mapMutations (mutations) {
  const res = {}
  normalizeMap(mutations).forEach(({ key, val }) => {
    res[key] = function mappedMutation (...args) {
      return this.$store.commit.apply(this.$store, [val].concat(args))
    }
  })
  return res
}

export function mapGetters (getters) {
  const res = {}
  normalizeMap(getters).forEach(({ key, val }) => {
    res[key] = function mappedGetter () {
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

function normalizeMap (map) {
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key }))
    : Object.keys(map).map(key => ({ key, val: map[key] }))
}
