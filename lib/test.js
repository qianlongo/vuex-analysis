const EventEmitter = require('./event-emitter')
let ee = new EventEmitter()
    
// 添加订阅1
ee.on('eat', (args) => {
  console.log(`我是订阅者1： ${args}`)
})
// 添加订阅2
ee.on('eat', (args) => {
  console.log(`我是订阅者2： ${args}`)
})
// 添加订阅2
ee.on('drink', (args) => {
  console.log(`我是订阅者2： ${args}`)
})
// 添加订阅3
ee.on('drink', (args) => {
  console.log(`我是订阅者3： ${args}`)
})

// 发布消息
ee.emit('eat', [ '黄焖鸡', '烤鱼' ])
ee.emit('drink', [ '可乐', '牛奶' ])