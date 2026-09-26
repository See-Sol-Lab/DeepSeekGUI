# DeepSeekGUI licensing

DeepSeekGUI contains both upstream DeepSeek Harness code and original See-Sol-Lab product work. Those layers are licensed separately. The repository-root [`LICENSE`](LICENSE) is a short scope notice, not a single license grant for the entire repository.

## Upstream DeepSeek Harness

Upstream DeepSeek Harness code and upstream-derived material remain under DeepSeek's MIT License. The preserved upstream MIT text is in [`LICENSE-MIT-UPSTREAM`](LICENSE-MIT-UPSTREAM). Nothing in the DeepSeekGUI product license narrows, revokes, or replaces rights already granted by DeepSeek or other third-party licensors.

## DeepSeekGUI product layer

Original See-Sol-Lab-authored DeepSeekGUI product code, documentation, and assets are licensed under the **PolyForm Perimeter License 1.0.1**, including components outside `apps/deepseekgui/`. The full license text is in [`apps/deepseekgui/LICENSE`](apps/deepseekgui/LICENSE).

The product layer includes [`apps/deepseekgui/`](apps/deepseekgui/) and these original host packages, each carrying its own copy of the license:

- [Workbench inspector](packages/api/workbench-inspector/LICENSE)
- [Local Skill manager](packages/api/skill-manager/LICENSE)
- [Engineering memory](packages/api/workbench-memory/LICENSE)

New original See-Sol-Lab product components use the same license and must declare it in their package metadata and include the license text in their distributed files. Upstream-derived code and third-party material retain their respective licenses; a directory location or package name does not change their ownership. This notice does not revoke rights already granted in earlier releases.

**中文范围说明：** See-Sol-Lab 自研的 DeepSeekGUI 产品代码、文档和原创资源统一采用 PolyForm Perimeter License 1.0.1，包括桌面层及上述三个宿主包。后续新增自研组件同样适用，并须同步声明包许可、随包携带协议全文。上游及上游派生代码、第三方材料保留各自许可；本说明不撤销先前版本已经授予的权利。

## Permitted use and competition boundary

The PolyForm Perimeter License permits use, modification, and distribution of the DeepSeekGUI-covered product layer for any permitted purpose, including personal, educational, research, hobby, and internal business use.

The license does **not** permit providing to others a product that competes with DeepSeekGUI. A product competes when it is marketed as a substitute for the functionality or value of the DeepSeekGUI-covered software, whether it is distributed as software, a service, a library, a plug-in, a port, or another form, and whether it is offered for free or for payment.

Uses outside the PolyForm Perimeter License, including distributing or operating a competing product based on the DeepSeekGUI-covered product layer, require a separate written license from See-Sol-Lab.

Commercial licensing inquiries may be directed to the See-Sol-Lab repository owner.

## Names, logos, and branding

No trademark or branding rights are granted by the software licenses. The names **DeepSeekGUI** and **See-Sol-Lab**, and DeepSeekGUI-specific logos, icons, and brand assets, may not be used to imply endorsement, affiliation, or authorization. Separate written permission is required for commercial brand use.

## Third-party notices

Third-party software remains under its own terms. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and any license files shipped with vendored or packaged components.

## Terminology

Because the DeepSeekGUI product layer restricts use that competes with the software, it is **source-available**, not OSI-approved open-source software. The upstream MIT-licensed DeepSeek Harness portions remain open source under their upstream terms.
