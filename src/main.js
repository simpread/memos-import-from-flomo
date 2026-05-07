const fs = require("fs-extra");
const cheerio = require("cheerio");
var TurndownService = require("turndown");
const chalk = require("chalk");

const { htmlPath, getFilePath, mergePromise, errorTip } = require("./utils/utils");
const { uploadAttachment, sendMemo, updateMemo } = require("./utils/api");

fs.removeSync("./memo.json");
fs.removeSync("./sendedIds.json");

const sendedMemoNames = [];
const memoArr = [];

const $ = cheerio.load(fs.readFileSync(htmlPath, "utf8"));

const memos = $(".memo");

for (const memo of memos) {
  const time = $(memo).find(".time").text();
  let content = "";
  let tags = [];
  let files = [];

  $(memo)
    .find(".content")
    .each((index, html) => {
      let text = $(html).html();

      var turndownService = new TurndownService();
      text = turndownService.turndown(text);

      content += `${content ? "\n" : ""}${text}`;
    }, "");

  // 正则通过 #xxx 获取标签
  const tagReg = /#(\S*)/g;
  const tagMatch = content.match(tagReg);
  if (tagMatch) {
    tags = tagMatch.map((item) => item.replace("#", "")).filter((tag) => !!tag);
  }

  $(memo)
    .find(".files img")
    .each((index, img) => {
      const src = $(img).attr("src");
      files.push(src);
    });

  memoArr.push({
    time,
    content,
    files,
    tags,
  });
}

memoArr.sort((a, b) => {
  return new Date(b.time) - new Date(a.time);
});

async function sendMemoHandler() {
  const sendMemoPromiseArr = [];

  fs.writeJSONSync("./memo.json", memoArr);

  console.log(chalk.green("======================= 发送 Memo ======================="));
  console.log(chalk.blue(`总计待发送: ${memoArr.length} 条`));

  let currentCount = 0;
  const totalCount = memoArr.length;

  for (const memo of memoArr) {
    let content = memo.content;

    memo.tags.forEach((tag) => {
      content += ` #${tag}`;
    });

    sendMemoPromiseArr.unshift(async () => {
      try {
        currentCount++;
        console.log(chalk.yellow(`正在发送 [${currentCount}/${totalCount}]`));
        return await sendMemo({
          content: memo.content,
          // createdTs: new Date(memo.time).getTime() / 1000,
        }).then(async (res) => {
          const memoName = res?.data?.name || res?.data?.data?.name;
          sendedMemoNames.push(memoName);

          await updateMemo(memoName, new Date(memo.time).toISOString());

          const uploadAttachmentPromiseArr = [];
          if (memo.files.length) {
            for (const filePath of memo.files) {
              const fullPath = getFilePath(filePath);
              uploadAttachmentPromiseArr.push(() => {
                console.log(chalk.green("开始上传附件"), filePath);
                return uploadAttachment(fullPath, memoName);
              });
            }
          }

          if (uploadAttachmentPromiseArr.length) {
            await mergePromise(uploadAttachmentPromiseArr);
          }

          console.log(chalk.green(`发送成功 [${currentCount}/${totalCount}]`));

          fs.writeJSONSync("./sendedIds.json", sendedMemoNames);
        });
      } catch (error) {
        console.log(chalk.red(`发送失败 [${currentCount}/${totalCount}]`));
        errorTip(error);
      }
    });
  }

  await mergePromise(sendMemoPromiseArr);
  console.log(chalk.green("======================= 发送 Memo 完成 ======================="));
}

sendMemoHandler();
