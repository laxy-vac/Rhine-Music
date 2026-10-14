/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 13 февр. 2021 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_FMT_JSON_DOM_H_
#define LSP_PLUG_IN_FMT_JSON_DOM_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/json/token.h>
#include <lsp-plug.in/fmt/json/dom/Node.h>
#include <lsp-plug.in/fmt/json/dom/Integer.h>
#include <lsp-plug.in/fmt/json/dom/Double.h>
#include <lsp-plug.in/fmt/json/dom/Boolean.h>
#include <lsp-plug.in/fmt/json/dom/String.h>
#include <lsp-plug.in/fmt/json/dom/Array.h>
#include <lsp-plug.in/fmt/json/dom/Object.h>

#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/io/IInSequence.h>
#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/io/IOutSequence.h>
#include <lsp-plug.in/io/IOutStream.h>

namespace lsp
{
    namespace json
    {
        enum dom_flags_t
        {
            DOM_CLOSE       = 1 << 0,
            DOM_DELETE      = 1 << 1,
            DOM_FLEXIBLE    = 1 << 2
        };

        status_t    dom_load(const char *path, Node *node, json_version_t version, const char *charset = NULL);
        status_t    dom_load(const LSPString *path, Node *node, json_version_t version, const char *charset = NULL);
        status_t    dom_load(const io::Path *path, Node *node, json_version_t version, const char *charset = NULL);

        status_t    dom_parse(io::IInStream *is, Node *node, json_version_t version, size_t flags = 0, const char *charset = NULL);
        status_t    dom_parse(const LSPString *data, Node *node, json_version_t version);
        status_t    dom_parse(const char *data, Node *node, json_version_t version, size_t flags = 0, const char *charset = NULL);
        status_t    dom_parse(io::IInSequence *is, Node *node, json_version_t version, size_t flags = 0);

        status_t    dom_save(const char *path, const Node *node, const serial_flags_t *settings = NULL, const char *charset = NULL);
        status_t    dom_save(const LSPString *path, const Node *node, const serial_flags_t *settings = NULL, const char *charset = NULL);
        status_t    dom_save(const io::Path *path, const Node *node, const serial_flags_t *settings = NULL, const char *charset = NULL);

        status_t    dom_write(io::IOutStream *os, const Node *node, const serial_flags_t *settings = NULL, size_t flags = 0, const char *charset = NULL);
        status_t    dom_write(LSPString *data, const Node *node, const serial_flags_t *settings = NULL);
        status_t    dom_write(io::IOutSequence *os, const Node *node, const serial_flags_t *settings = NULL, size_t flags = 0);

    } /* namespace json */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_JSON_DOM_H_ */
