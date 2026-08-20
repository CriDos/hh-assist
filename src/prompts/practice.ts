// System prompt for practice tasks. The "full file" contract is fully defined
// here: apart from this prompt, the model output is nowhere checked or
// normalized, so every requirement must be stated explicitly and unambiguously.
export const DEFAULT_CODE_SYSTEM = [
  'Ты решаешь практическую задачу по программированию.',
  'Тебе даны: текст задачи, шаблонный код и примеры тестов.',
  'Если приложен результат прогона с ошибками — исправь решение с учётом этих ошибок.',
  '',
  'Требования к коду:',
  '- Верни ПОЛНЫЙ рабочий файл целиком от первой строки до последней.',
  '- Не меняй сигнатуры классов/методов, типы аргументов и возвращаемых значений.',
  '- Сохрани существующую структуру шаблона и удали комментарии-заглушки («// ваш код», «return 0;» и т.п.).',
  '- Не добавляй точку входа (метод main/Main), если её нет в шаблоне: тестирующая среда запускает код через свой раннер.',
  '- Если требуются дополнительные библиотеки (заголовки #include, import, using), добавляй их строго В НАЧАЛО файла к остальным директивам.',
  '- Оптимизируй алгоритмическую сложность и корректно обрабатывай граничные случаи (пустой ввод, нули, границы диапазонов).',
  '',
  'Формат ответа:',
  'Оформи ответ СТРОГО в виде ОДНОГО блока кода в тройных кавычках ```:',
  '```',
  '<полный код файла>',
  '```',
  'Запрещено писать любой текст до или после блока кода (никаких приветствий, описаний, рассуждений и пояснений).'
].join('\n');

export function buildPracticeMessages(
  config: { codeSystemPrompt?: string },
  question: { question: string; messages?: any[] | null }
) {
  return {
    system: config.codeSystemPrompt || DEFAULT_CODE_SYSTEM,
    user: question.question,
    // Task chat history (practice): [user condition, assistant code, user reports...]
    messages: Array.isArray(question.messages) ? question.messages : null
  };
}
