import React from "react";
import { Card, Group, Text, Box, Rating, Checkbox } from "@mantine/core";
import classes from "../../pages/student/DigitalSkillWallet.module.css";

const VerifiedSkillCard = ({ skill, checked, onChange }) => {
  return (
    <Card shadow="sm" radius="md" withBorder>
      <Group align="center">
        <Group align="center">
          {skill.icon}
          <Text size="md" fw={700}>
            {skill.title}
          </Text>
        </Group>
      </Group>

      <Box mt="sm" ml="49px">
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            Course:
          </Text>
          <Text size="sm" fw={400}>
            {skill.course}
          </Text>
        </Group>
        <Group gap="xs" mt={4}>
          <Text size="sm" c="dimmed">
            Verified by:
          </Text>
          <Text size="sm" fw={400}>
            {skill.verifiedBy}
          </Text>
        </Group>
        <Group gap="xs" mt={4}>
          <Text size="sm" c="dimmed">
            Score:
          </Text>
          <Rating value={skill.score} fractions={2} readOnly />
          <Text size="sm" fw={400}>
            ({skill.score})
          </Text>
        </Group>

        <Checkbox
          classNames={{ label: classes.checkboxLabel }}
          mt={4}
          size="xs"
          label="Visible to Employers"
          checked={checked}
          onChange={onChange}
        />
      </Box>
    </Card>
  );
};

export default VerifiedSkillCard;
