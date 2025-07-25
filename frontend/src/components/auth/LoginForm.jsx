// components/LoginForm.jsx
import React, { useState } from "react";
import { useNavigate } from 'react-router-dom';
import { Anchor, Button, Checkbox, Paper, PasswordInput, Text, TextInput, Title } from '@mantine/core';

export default function LoginForm({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const [error, setError] = useState("");

  const handleLogin = async () => {
    try {
      await onLogin(email, password);
    } catch (err) {
      setError(err.message || "Login failed");
    }
  };

  return (
    <div className="wrapper">
      <Paper className="form" radius={0} p={30}>
        <Title order={2} ta="center" mt="md" mb={50}>Welcome back to Skivy!</Title>
        {error && <Text color="red">{error}</Text>}

        <TextInput label="Email" placeholder="Your email address" size="md" onChange={(e) => setEmail(e.target.value)} />
        <PasswordInput label="Password" placeholder="Your password" mt="md" size="md" onChange={(e) => setPassword(e.target.value)} />

        <Checkbox label="Keep me logged in" mt="xl" size="md" />

        <Button fullWidth mt="xl" size="md" onClick={handleLogin}>Login</Button>

        <Text ta="center" mt="md">
          Don&apos;t have an account?{' '}
          <Anchor href="#" fw={700} onClick={(e) => { e.preventDefault(); navigate('/register'); }}>
            Register
          </Anchor>
        </Text>
      </Paper>
    </div>
  );
}
