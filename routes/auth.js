const express = require('express')
const fs = require('fs')
const path = require('path')
const router = express.Router()

const usersFile = path.join(__dirname, '..', 'data', 'users.json')

const readUsers = () => {
  try {
    const raw = fs.readFileSync(usersFile, 'utf8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

const writeUsers = (users) => {
  try {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2))
  } catch (err) {
    console.error('Failed to write users file:', err)
  }
}

router.post('/register', (req, res) => {
  const { name, email, password } = req.body
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const users = readUsers()
  const existing = users.find(u => u.email === email.toLowerCase())
  if (existing) {
    return res.status(400).json({ error: 'User already exists' })
  }

  const user = { id: Date.now().toString(), name, email: email.toLowerCase(), password }
  users.push(user)
  writeUsers(users)

  return res.json({
    token: `${user.id}:${Date.now()}`,
    user: { id: user.id, name: user.name, email: user.email }
  })
})

router.post('/login', (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const users = readUsers()
  const user = users.find(u => u.email === email.toLowerCase())
  if (!user || user.password !== password) {
    return res.status(400).json({ error: 'Invalid email or password' })
  }

  return res.json({
    token: `${user.id}:${Date.now()}`,
    user: { id: user.id, name: user.name, email: user.email }
  })
})

module.exports = router
